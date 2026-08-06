import { errorResponse } from "@/lib/api-response";
import { moveFolderToTrash, updateFolder } from "@/lib/content-service";
import { getDatabase } from "@/lib/database";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const folderIdSchema = z.uuid();
const updateFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    parentId: z.uuid().nullable().optional(),
    position: z.int().min(0).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "至少需要修改一个文件夹字段。",
  });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ folderId: string }> },
) {
  try {
    const { folderId: rawFolderId } = await context.params;
    const folderId = folderIdSchema.parse(rawFolderId);
    const mutation = updateFolderSchema.parse(await request.json());
    const folder = await updateFolder(
      getDatabase(),
      await readGuestCredential(),
      folderId,
      mutation,
    );

    return Response.json(folder);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ folderId: string }> },
) {
  try {
    const { folderId: rawFolderId } = await context.params;
    const result = await moveFolderToTrash(
      getDatabase(),
      await readGuestCredential(),
      folderIdSchema.parse(rawFolderId),
    );

    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
