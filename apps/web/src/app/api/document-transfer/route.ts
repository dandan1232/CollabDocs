import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { importDocumentSource } from "@/lib/document-transfer";
import { requireGuestSession } from "@/lib/guest-service";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const transferSchema = z.object({
  format: z.enum(["markdown", "html"]),
  source: z.string().max(2_000_000),
});

export async function POST(request: Request) {
  try {
    await requireGuestSession(getDatabase(), await readGuestCredential());
    const input = transferSchema.parse(await request.json());
    return Response.json({
      html: importDocumentSource(input.format, input.source),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
