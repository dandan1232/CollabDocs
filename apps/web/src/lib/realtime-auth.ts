import { SharePermission, type PrismaClient } from "@collabdocs/db";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { GuestServiceError, requireGuestSession } from "./guest-service";
import { requireActiveShareById, requireDocumentAccess } from "./share-service";

const TOKEN_TTL_MS = 10 * 60 * 1000;

type RealtimeTokenPayload = {
  guestId: string;
  documentId: string;
  expiresAt: number;
  shareId?: string;
};

function credentialHash(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

function signPayload(encodedPayload: string, signingKey: string): string {
  return createHmac("sha256", signingKey)
    .update(encodedPayload)
    .digest("base64url");
}

function parsePayload(encodedPayload: string): RealtimeTokenPayload {
  try {
    const value = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<RealtimeTokenPayload>;

    if (
      typeof value.guestId !== "string" ||
      typeof value.documentId !== "string" ||
      typeof value.expiresAt !== "number" ||
      (value.shareId !== undefined && typeof value.shareId !== "string")
    ) {
      throw new Error("Invalid payload");
    }

    return value as RealtimeTokenPayload;
  } catch {
    throw new GuestServiceError(
      "REALTIME_TOKEN_INVALID",
      "实时协作令牌无效。",
      401,
    );
  }
}

export async function issueRealtimeToken(
  database: PrismaClient,
  credential: string | undefined,
  documentId: string,
  shareToken?: string,
) {
  if (!credential) {
    throw new GuestServiceError(
      "GUEST_SESSION_REQUIRED",
      "请先初始化匿名身份。",
      401,
    );
  }

  const session = await requireGuestSession(database, credential);
  const access = await requireDocumentAccess(
    database,
    credential,
    documentId,
    shareToken,
    "view",
  );

  const payload: RealtimeTokenPayload = {
    guestId: session.guest.id,
    documentId,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    ...(access.shareId ? { shareId: access.shareId } : {}),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signPayload(encodedPayload, credentialHash(credential));

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(payload.expiresAt),
  };
}

export async function verifyRealtimeToken(
  database: PrismaClient,
  token: string,
  documentId: string,
) {
  const [encodedPayload, signature, ...extra] = token.split(".");
  if (!encodedPayload || !signature || extra.length > 0) {
    throw new GuestServiceError(
      "REALTIME_TOKEN_INVALID",
      "实时协作令牌无效。",
      401,
    );
  }

  const payload = parsePayload(encodedPayload);
  if (payload.documentId !== documentId || payload.expiresAt <= Date.now()) {
    throw new GuestServiceError(
      "REALTIME_TOKEN_EXPIRED",
      "实时协作令牌已过期，请重新连接。",
      401,
    );
  }

  const guest = await database.guestIdentity.findUnique({
    where: { id: payload.guestId },
    select: {
      id: true,
      nickname: true,
      avatarSeed: true,
      presenceColor: true,
      credentialHash: true,
      memberships: { select: { workspaceId: true } },
    },
  });
  if (!guest) {
    throw new GuestServiceError(
      "DOCUMENT_ACCESS_DENIED",
      "你没有访问这个文档的权限。",
      403,
    );
  }

  const expectedSignature = signPayload(encodedPayload, guest.credentialHash);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new GuestServiceError(
      "REALTIME_TOKEN_INVALID",
      "实时协作令牌无效。",
      401,
    );
  }

  const document = await database.document.findUnique({
    where: { id: documentId },
    select: { workspaceId: true, deletedAt: true },
  });

  let readOnly = false;
  let authorized = false;
  if (guest && document && !document.deletedAt) {
    if (payload.shareId) {
      const share = await requireActiveShareById(
        database,
        payload.shareId,
        documentId,
      );
      readOnly = share.permission === SharePermission.VIEW;
      authorized = true;
    } else {
      authorized = guest.memberships.some(
        (membership) => membership.workspaceId === document.workspaceId,
      );
    }
  }

  if (!document || document.deletedAt || !authorized) {
    throw new GuestServiceError(
      "DOCUMENT_ACCESS_DENIED",
      "你没有访问这个文档的权限。",
      403,
    );
  }

  return {
    id: guest.id,
    nickname: guest.nickname,
    avatarUrl: `/api/avatars/${encodeURIComponent(guest.avatarSeed)}`,
    presenceColor: guest.presenceColor,
    readOnly,
  };
}
