import { errorResponse } from "@/lib/api-response";
import { createFolder } from "@/lib/content-service";
import { getDatabase } from "@/lib/database";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const createFolderSchema = z.object({
  workspaceId: z.uuid(),
  parentId: z.uuid().nullable().optional(),
  name: z.string().trim().min(1).max(160),
});

export async function POST(request: Request) {
  try {
    const input = createFolderSchema.parse(await request.json());
    const folder = await createFolder(
      getDatabase(),
      await readGuestCredential(),
      input,
    );

    return Response.json(folder, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
