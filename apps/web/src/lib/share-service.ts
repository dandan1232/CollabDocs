import {
  SharePermission,
  type PrismaClient,
  WorkspaceRole,
} from "@collabdocs/db";
import { createHash, randomBytes } from "node:crypto";

import {
  GuestServiceError,
  requireGuestSession,
  type GuestSession,
} from "./guest-service";

const SHARE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function createShareToken(): string {
  return `cds_${randomBytes(32).toString("base64url")}`;
}

function assertShareToken(token: string): void {
  if (!token.startsWith("cds_") || token.length > 80) {
    throw new GuestServiceError(
      "INVALID_SHARE_LINK",
      "文档分享链接无效或已经失效。",
      400,
    );
  }
}

async function findActiveShare(
  database: PrismaClient,
  documentId: string,
  token: string,
) {
  assertShareToken(token);
  const share = await database.shareLink.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: {
      document: {
        include: {
          workspace: { select: { id: true, name: true, deletedAt: true } },
        },
      },
    },
  });

  if (
    !share ||
    share.documentId !== documentId ||
    share.revokedAt ||
    share.document.deletedAt ||
    share.document.workspace.deletedAt ||
    (share.expiresAt && share.expiresAt <= new Date())
  ) {
    throw new GuestServiceError(
      "INVALID_SHARE_LINK",
      "文档分享链接无效、已过期或已被撤销。",
      403,
    );
  }

  return share;
}

export async function issueDocumentShareLink(
  database: PrismaClient,
  credential: string | undefined,
  documentId: string,
  permission: SharePermission,
) {
  const session = await requireGuestSession(database, credential);
  const document = await database.document.findUnique({
    where: { id: documentId },
    include: { workspace: { select: { name: true, deletedAt: true } } },
  });

  if (!document || document.deletedAt || document.workspace.deletedAt) {
    throw new GuestServiceError(
      "DOCUMENT_NOT_FOUND",
      "文档不存在或已在回收站中。",
      404,
    );
  }

  const membership = await database.workspaceMember.findUnique({
    where: {
      workspaceId_guestId: {
        workspaceId: document.workspaceId,
        guestId: session.guest.id,
      },
    },
  });
  if (
    !membership ||
    (membership.role !== WorkspaceRole.OWNER &&
      membership.role !== WorkspaceRole.ADMIN)
  ) {
    throw new GuestServiceError(
      "SHARE_PERMISSION_DENIED",
      "只有空间所有者或管理员可以创建公开分享链接。",
      403,
    );
  }

  const token = createShareToken();
  const expiresAt = new Date(Date.now() + SHARE_LIFETIME_MS);
  const share = await database.shareLink.create({
    data: {
      tokenHash: hashSecret(token),
      documentId,
      permission,
      createdById: session.guest.id,
      expiresAt,
    },
  });

  return {
    id: share.id,
    token,
    documentId,
    documentTitle: document.title,
    workspaceName: document.workspace.name,
    permission: permission.toLowerCase() as "view" | "edit",
    expiresAt: expiresAt.toISOString(),
  };
}

export async function resolveDocumentShare(
  database: PrismaClient,
  credential: string | undefined,
  token: string,
) {
  const session = await requireGuestSession(database, credential);
  assertShareToken(token);
  const share = await database.shareLink.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: {
      document: {
        include: {
          workspace: { select: { id: true, name: true, deletedAt: true } },
        },
      },
    },
  });

  if (
    !share ||
    share.revokedAt ||
    share.document.deletedAt ||
    share.document.workspace.deletedAt ||
    (share.expiresAt && share.expiresAt <= new Date())
  ) {
    throw new GuestServiceError(
      "INVALID_SHARE_LINK",
      "文档分享链接无效、已过期或已被撤销。",
      403,
    );
  }

  return {
    documentId: share.documentId,
    documentTitle: share.document.title,
    workspaceName: share.document.workspace.name,
    permission: share.permission.toLowerCase() as "view" | "edit",
    viewer: session.guest,
  };
}

export async function requireDocumentAccess(
  database: PrismaClient,
  credential: string | undefined,
  documentId: string,
  shareToken: string | undefined,
  requiredPermission: "view" | "edit",
): Promise<{
  session: GuestSession;
  permission: "view" | "edit";
  canShare: boolean;
  shareId: string | null;
}> {
  const session = await requireGuestSession(database, credential);
  const document = await database.document.findUnique({
    where: { id: documentId },
    select: { workspaceId: true, deletedAt: true },
  });

  if (!document || document.deletedAt) {
    throw new GuestServiceError(
      "DOCUMENT_NOT_FOUND",
      "文档不存在或已在回收站中。",
      404,
    );
  }

  const workspace = session.workspaces.find(
    (item) => item.id === document.workspaceId,
  );
  if (workspace) {
    return {
      session,
      permission: "edit",
      canShare: workspace.role === "owner" || workspace.role === "admin",
      shareId: null,
    };
  }

  if (!shareToken) {
    throw new GuestServiceError(
      "DOCUMENT_ACCESS_DENIED",
      "你没有访问这个文档的权限。",
      403,
    );
  }

  const share = await findActiveShare(database, documentId, shareToken);
  if (
    requiredPermission === "edit" &&
    share.permission !== SharePermission.EDIT
  ) {
    throw new GuestServiceError(
      "DOCUMENT_READ_ONLY",
      "这个分享链接只有查看权限。",
      403,
    );
  }

  return {
    session,
    permission: share.permission.toLowerCase() as "view" | "edit",
    canShare: false,
    shareId: share.id,
  };
}

export async function requireActiveShareById(
  database: PrismaClient,
  shareId: string,
  documentId: string,
) {
  const share = await database.shareLink.findUnique({
    where: { id: shareId },
    select: {
      documentId: true,
      permission: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (
    !share ||
    share.documentId !== documentId ||
    share.revokedAt ||
    (share.expiresAt && share.expiresAt <= new Date())
  ) {
    throw new GuestServiceError(
      "INVALID_SHARE_LINK",
      "文档分享链接无效、已过期或已被撤销。",
      403,
    );
  }

  return share;
}
