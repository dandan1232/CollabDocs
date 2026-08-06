import { moveDocumentToTrash, updateDocument } from "@/lib/content-service";
import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const documentIdSchema = z.uuid();
const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    folderId: z.uuid().nullable().optional(),
    position: z.int().min(0).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "至少需要修改一个文档字段。",
  });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId: rawDocumentId } = await context.params;
    const document = await updateDocument(
      getDatabase(),
      await readGuestCredential(),
      documentIdSchema.parse(rawDocumentId),
      updateDocumentSchema.parse(await request.json()),
    );

    return Response.json(document);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId: rawDocumentId } = await context.params;
    const document = await moveDocumentToTrash(
      getDatabase(),
      await readGuestCredential(),
      documentIdSchema.parse(rawDocumentId),
    );

    return Response.json(document);
  } catch (error) {
    return errorResponse(error);
  }
}
