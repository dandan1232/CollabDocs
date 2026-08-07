import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { acceptWorkspaceInvite } from "@/lib/guest-service";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const acceptInviteSchema = z.object({
  token: z.string().trim().min(32).max(80),
});

export async function POST(request: Request) {
  try {
    const input = acceptInviteSchema.parse(await request.json());
    const result = await acceptWorkspaceInvite(
      getDatabase(),
      await readGuestCredential(),
      input.token,
    );

    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
