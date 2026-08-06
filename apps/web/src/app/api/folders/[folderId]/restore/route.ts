import { errorResponse } from "@/lib/api-response";
import { restoreFolder } from "@/lib/content-service";
import { getDatabase } from "@/lib/database";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const folderIdSchema = z.uuid();

export async function POST(
  _request: Request,
  context: { params: Promise<{ folderId: string }> },
) {
  try {
    const { folderId: rawFolderId } = await context.params;
    const result = await restoreFolder(
      getDatabase(),
      await readGuestCredential(),
      folderIdSchema.parse(rawFolderId),
    );

    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
