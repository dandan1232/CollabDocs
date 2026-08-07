import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { resolveDocumentShare } from "@/lib/share-service";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const resolveSchema = z.object({
  token: z.string().trim().min(32).max(80),
});

export async function POST(request: Request) {
  try {
    const input = resolveSchema.parse(await request.json());
    const share = await resolveDocumentShare(
      getDatabase(),
      await readGuestCredential(),
      input.token,
    );

    return Response.json(share, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
