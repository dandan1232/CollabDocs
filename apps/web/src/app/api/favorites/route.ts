import { errorResponse } from "@/lib/api-response";
import { addFavorite, removeFavorite } from "@/lib/content-service";
import { getDatabase } from "@/lib/database";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const favoriteSchema = z
  .object({
    documentId: z.uuid().optional(),
    folderId: z.uuid().optional(),
  })
  .refine(
    (input) =>
      Number(Boolean(input.documentId)) + Number(Boolean(input.folderId)) === 1,
    { message: "收藏目标必须是一个文档或文件夹。" },
  );

export async function PUT(request: Request) {
  try {
    const favorite = await addFavorite(
      getDatabase(),
      await readGuestCredential(),
      favoriteSchema.parse(await request.json()),
    );

    return Response.json(favorite, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const result = await removeFavorite(
      getDatabase(),
      await readGuestCredential(),
      favoriteSchema.parse(await request.json()),
    );

    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
