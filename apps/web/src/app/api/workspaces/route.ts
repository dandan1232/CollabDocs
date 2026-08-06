import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { createTeamWorkspace, requireGuestSession } from "@/lib/guest-service";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(32).optional(),
});

export async function GET() {
  try {
    const session = await requireGuestSession(
      getDatabase(),
      await readGuestCredential(),
    );

    return Response.json({ workspaces: session.workspaces });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = workspaceSchema.parse(await request.json());
    const session = await createTeamWorkspace(
      getDatabase(),
      await readGuestCredential(),
      input,
    );

    return Response.json(session, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
