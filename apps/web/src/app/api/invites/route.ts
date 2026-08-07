import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { issueWorkspaceInvite } from "@/lib/guest-service";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const inviteSchema = z.object({
  workspaceId: z.uuid(),
});

export async function POST(request: Request) {
  try {
    const input = inviteSchema.parse(await request.json());
    const invite = await issueWorkspaceInvite(
      getDatabase(),
      await readGuestCredential(),
      input.workspaceId,
    );

    return Response.json(invite, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
