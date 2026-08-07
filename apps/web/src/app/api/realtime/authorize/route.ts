import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { verifyRealtimeToken } from "@/lib/realtime-auth";
import { z } from "zod";

const authorizationSchema = z.object({
  token: z.string().min(32).max(2048),
  documentId: z.uuid(),
});

export async function POST(request: Request) {
  try {
    const input = authorizationSchema.parse(await request.json());
    const user = await verifyRealtimeToken(
      getDatabase(),
      input.token,
      input.documentId,
    );

    return Response.json(
      { user },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
