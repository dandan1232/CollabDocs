import { AssetStatus, type PrismaClient } from "@collabdocs/db";
import { randomUUID } from "node:crypto";

import { GuestServiceError, requireGuestSession } from "./guest-service";
import { requireDocumentAccess } from "./share-service";

export const MAX_ASSET_SIZE = 20 * 1024 * 1024;
export const ASSET_UPLOAD_LIFETIME_MS = 60 * 60 * 1000;

const ALLOWED_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);

const MIME_TYPE_ALIASES = new Map([
  ["application/x-zip-compressed", "application/zip"],
  ["image/jpg", "image/jpeg"],
  ["text/x-markdown", "text/markdown"],
]);

interface AssetUploadInput {
  workspaceId: string;
  documentId: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
}

function cleanOriginalName(value: string): string {
  return value
    .replace(/[\\/\u0000-\u001f]/gu, "_")
    .trim()
    .slice(0, 255);
}

export function validateAssetMetadata(input: {
  originalName: string;
  mimeType: string;
  size: number;
}): { originalName: string; mimeType: string; size: number } {
  const originalName = cleanOriginalName(input.originalName);
  const rawMimeType = input.mimeType.trim().toLocaleLowerCase();
  const mimeType = MIME_TYPE_ALIASES.get(rawMimeType) ?? rawMimeType;

  if (!originalName) {
    throw new GuestServiceError(
      "ASSET_NAME_REQUIRED",
      "请选择一个有效的文件。",
      400,
    );
  }
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new GuestServiceError("ASSET_SIZE_INVALID", "文件大小无效。", 400);
  }
  if (input.size > MAX_ASSET_SIZE) {
    throw new GuestServiceError(
      "ASSET_TOO_LARGE",
      "单个文件不能超过 20 MB。",
      413,
    );
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new GuestServiceError(
      "ASSET_TYPE_NOT_ALLOWED",
      "暂不支持这种文件格式。",
      415,
    );
  }

  return { originalName, mimeType, size: input.size };
}

export async function authorizeAssetUpload(
  database: PrismaClient,
  credential: string | undefined,
  input: AssetUploadInput,
) {
  const session = await requireGuestSession(database, credential);
  const metadata = validateAssetMetadata(input);
  const staleBefore = new Date(Date.now() - ASSET_UPLOAD_LIFETIME_MS);
  const objectKey = `workspaces/${input.workspaceId}/assets/${randomUUID()}`;

  return database.$transaction(async (transaction) => {
    const workspace = await transaction.workspace.findFirst({
      where: {
        id: input.workspaceId,
        deletedAt: null,
        members: { some: { guestId: session.guest.id } },
      },
      select: { id: true },
    });
    if (!workspace) {
      throw new GuestServiceError(
        "WORKSPACE_ACCESS_DENIED",
        "你没有访问这个空间的权限。",
        403,
      );
    }

    const document = await transaction.document.findFirst({
      where: {
        id: input.documentId,
        workspaceId: input.workspaceId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!document) {
      throw new GuestServiceError(
        "DOCUMENT_NOT_FOUND",
        "目标文档不存在或已在回收站中。",
        404,
      );
    }

    await transaction.$executeRaw`
      WITH expired AS (
        UPDATE assets
        SET status = 'FAILED'
        WHERE workspace_id = ${input.workspaceId}::uuid
          AND status = 'PENDING'
          AND created_at < ${staleBefore}
        RETURNING size
      )
      UPDATE workspaces
      SET storage_used = greatest(
            0::bigint,
            storage_used - coalesce((SELECT sum(size) FROM expired), 0::bigint)
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${input.workspaceId}::uuid
        AND EXISTS (SELECT 1 FROM expired)
    `;

    const reserved = await transaction.$queryRaw<Array<{ id: string }>>`
      UPDATE workspaces
      SET storage_used = storage_used + ${BigInt(metadata.size)}::bigint,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${input.workspaceId}::uuid
        AND deleted_at IS NULL
        AND storage_used + ${BigInt(metadata.size)}::bigint <= storage_limit
      RETURNING id
    `;
    if (reserved.length === 0) {
      throw new GuestServiceError(
        "STORAGE_QUOTA_EXCEEDED",
        "空间存储额度不足，请清理文件后重试。",
        413,
      );
    }

    const asset = await transaction.asset.create({
      data: {
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        objectKey,
        originalName: metadata.originalName,
        mimeType: metadata.mimeType,
        size: BigInt(metadata.size),
        width: input.width,
        height: input.height,
        createdById: session.guest.id,
      },
    });

    return {
      assetId: asset.id,
      uploadUrl: `/api/assets/${asset.id}/content`,
      mimeType: metadata.mimeType,
      expiresAt: new Date(
        asset.createdAt.getTime() + ASSET_UPLOAD_LIFETIME_MS,
      ).toISOString(),
    };
  });
}

export async function requirePendingAssetUpload(
  database: PrismaClient,
  credential: string | undefined,
  assetId: string,
) {
  const session = await requireGuestSession(database, credential);
  const asset = await database.asset.findFirst({
    where: {
      id: assetId,
      createdById: session.guest.id,
      status: AssetStatus.PENDING,
      deletedAt: null,
    },
  });

  if (!asset) {
    throw new GuestServiceError(
      "ASSET_UPLOAD_NOT_FOUND",
      "上传任务不存在或已经结束。",
      404,
    );
  }
  if (asset.createdAt.getTime() + ASSET_UPLOAD_LIFETIME_MS <= Date.now()) {
    await failAssetUpload(database, asset.id, session.guest.id);
    throw new GuestServiceError(
      "ASSET_UPLOAD_EXPIRED",
      "上传授权已过期，请重新选择文件。",
      410,
    );
  }

  return asset;
}

export async function completeAssetUpload(
  database: PrismaClient,
  assetId: string,
  guestId: string,
) {
  const updated = await database.asset.updateMany({
    where: {
      id: assetId,
      createdById: guestId,
      status: AssetStatus.PENDING,
      deletedAt: null,
    },
    data: { status: AssetStatus.READY },
  });
  if (updated.count !== 1) {
    throw new GuestServiceError(
      "ASSET_UPLOAD_CONFLICT",
      "上传任务状态已经改变，请重新选择文件。",
      409,
    );
  }
}

export async function failAssetUpload(
  database: PrismaClient,
  assetId: string,
  guestId: string,
): Promise<void> {
  await database.$executeRaw`
    WITH failed AS (
      UPDATE assets
      SET status = 'FAILED'
      WHERE id = ${assetId}::uuid
        AND created_by_id = ${guestId}::uuid
        AND status = 'PENDING'
      RETURNING workspace_id, size
    )
    UPDATE workspaces AS workspace
    SET storage_used = greatest(0::bigint, workspace.storage_used - failed.size),
        updated_at = CURRENT_TIMESTAMP
    FROM failed
    WHERE workspace.id = failed.workspace_id
  `;
}

export async function requireReadableAsset(
  database: PrismaClient,
  credential: string | undefined,
  assetId: string,
  shareToken?: string,
) {
  const session = await requireGuestSession(database, credential);
  const asset = await database.asset.findFirst({
    where: {
      id: assetId,
      status: AssetStatus.READY,
      deletedAt: null,
    },
  });

  if (!asset) {
    throw new GuestServiceError(
      "ASSET_NOT_FOUND",
      "文件不存在或你没有访问权限。",
      404,
    );
  }

  const workspace = session.workspaces.some(
    (item) => item.id === asset.workspaceId,
  );
  if (!workspace) {
    if (!asset.documentId) {
      throw new GuestServiceError(
        "ASSET_NOT_FOUND",
        "文件不存在或你没有访问权限。",
        404,
      );
    }
    await requireDocumentAccess(
      database,
      credential,
      asset.documentId,
      shareToken,
      "view",
    );
  }

  return asset;
}
