import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { issueRealtimeToken } from "@/lib/realtime-auth";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const documentIdSchema = z.uuid();

export async function GET(request: Request) {
  try {
    const documentId = documentIdSchema.parse(
      new URL(request.url).searchParams.get("documentId"),
    );
    const result = await issueRealtimeToken(
      getDatabase(),
      await readGuestCredential(),
      documentId,
      request.headers.get("x-collabdocs-share") ?? undefined,
    );

    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
