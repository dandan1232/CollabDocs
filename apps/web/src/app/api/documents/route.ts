import { errorResponse } from "@/lib/api-response";
import { createDocument } from "@/lib/content-service";
import { getDatabase } from "@/lib/database";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const createDocumentSchema = z.object({
  workspaceId: z.uuid(),
  folderId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(240).default("无标题文档"),
});

export async function POST(request: Request) {
  try {
    const input = createDocumentSchema.parse(await request.json());
    const document = await createDocument(
      getDatabase(),
      await readGuestCredential(),
      input,
    );

    return Response.json(document, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
