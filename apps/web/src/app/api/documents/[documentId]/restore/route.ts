import { restoreDocument } from "@/lib/content-service";
import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const documentIdSchema = z.uuid();

export async function POST(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId: rawDocumentId } = await context.params;
    const document = await restoreDocument(
      getDatabase(),
      await readGuestCredential(),
      documentIdSchema.parse(rawDocumentId),
    );

    return Response.json(document);
  } catch (error) {
    return errorResponse(error);
  }
}
