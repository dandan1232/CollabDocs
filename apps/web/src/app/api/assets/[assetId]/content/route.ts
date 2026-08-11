import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { errorResponse } from "@/lib/api-response";
import {
  completeAssetUpload,
  failAssetUpload,
  requirePendingAssetUpload,
  requireReadableAsset,
} from "@/lib/asset-service";
import { getAssetStorage } from "@/lib/asset-storage";
import { getDatabase } from "@/lib/database";
import { GuestServiceError } from "@/lib/guest-service";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const assetIdSchema = z.uuid();

function shareTokenFromReferrer(request: Request): string | undefined {
  const referrer = request.headers.get("referer");
  if (!referrer) return undefined;

  try {
    const referrerUrl = new URL(referrer);
    return referrerUrl.origin === new URL(request.url).origin
      ? (referrerUrl.searchParams.get("share") ?? undefined)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  let pendingAsset:
    Awaited<ReturnType<typeof requirePendingAssetUpload>> | undefined;
  try {
    const { assetId: rawAssetId } = await context.params;
    const assetId = assetIdSchema.parse(rawAssetId);
    const database = getDatabase();
    pendingAsset = await requirePendingAssetUpload(
      database,
      await readGuestCredential(),
      assetId,
    );
    const contentLength = Number(request.headers.get("content-length"));
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength !== Number(pendingAsset.size)
    ) {
      throw new GuestServiceError(
        "ASSET_SIZE_MISMATCH",
        "上传内容与授权的文件大小不一致。",
        400,
      );
    }
    const contentType = request.headers.get("content-type")?.toLowerCase();
    if (contentType !== pendingAsset.mimeType) {
      throw new GuestServiceError(
        "ASSET_TYPE_MISMATCH",
        "上传内容与授权的文件格式不一致。",
        400,
      );
    }

    const body = Buffer.from(await request.arrayBuffer());
    if (body.byteLength !== Number(pendingAsset.size)) {
      throw new GuestServiceError(
        "ASSET_SIZE_MISMATCH",
        "文件上传不完整，请重试。",
        400,
      );
    }

    const { bucket, client } = getAssetStorage();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: pendingAsset.objectKey,
        Body: body,
        ContentLength: Number(pendingAsset.size),
        ContentType: pendingAsset.mimeType,
        Metadata: { assetId: pendingAsset.id },
      }),
    );
    try {
      await completeAssetUpload(
        database,
        pendingAsset.id,
        pendingAsset.createdById,
      );
    } catch (error) {
      await client
        .send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: pendingAsset.objectKey,
          }),
        )
        .catch((cleanupError: unknown) =>
          console.error("Failed to clean up uploaded asset", cleanupError),
        );
      throw error;
    }

    return Response.json({
      assetId: pendingAsset.id,
      url: `/api/assets/${pendingAsset.id}/content`,
      originalName: pendingAsset.originalName,
      mimeType: pendingAsset.mimeType,
      size: pendingAsset.size.toString(),
    });
  } catch (error) {
    if (pendingAsset) {
      await failAssetUpload(
        getDatabase(),
        pendingAsset.id,
        pendingAsset.createdById,
      ).catch(() => undefined);
    }
    return errorResponse(error);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId: rawAssetId } = await context.params;
    const assetId = assetIdSchema.parse(rawAssetId);
    const asset = await requireReadableAsset(
      getDatabase(),
      await readGuestCredential(),
      assetId,
      shareTokenFromReferrer(request),
    );
    const { bucket, client } = getAssetStorage();
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: asset.objectKey }),
    );
    if (!object.Body) {
      throw new Error(`Stored asset has no body: ${asset.id}`);
    }

    const disposition =
      asset.mimeType.startsWith("image/") ||
      asset.mimeType === "application/pdf"
        ? "inline"
        : "attachment";
    const bytes = Uint8Array.from(await object.Body.transformToByteArray());
    return new Response(bytes.buffer, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
        "Content-Length": asset.size.toString(),
        "Content-Type": asset.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
