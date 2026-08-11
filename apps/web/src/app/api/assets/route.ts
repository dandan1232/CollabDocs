import { errorResponse } from "@/lib/api-response";
import { authorizeAssetUpload, MAX_ASSET_SIZE } from "@/lib/asset-service";
import { getDatabase } from "@/lib/database";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const authorizeUploadSchema = z.object({
  workspaceId: z.uuid(),
  documentId: z.uuid(),
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  size: z.number().int().positive().max(MAX_ASSET_SIZE),
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
});

export async function POST(request: Request) {
  try {
    const input = authorizeUploadSchema.parse(await request.json());
    const authorization = await authorizeAssetUpload(
      getDatabase(),
      await readGuestCredential(),
      input,
    );

    return Response.json(authorization, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
