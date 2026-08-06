import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { bootstrapGuestSession, recoverWorkspace } from "@/lib/guest-service";
import {
  readGuestCredential,
  writeGuestCredential,
} from "@/lib/session-cookie";
import { z } from "zod";

const recoverySchema = z.object({
  recoveryKey: z.string().trim().min(1).max(80),
});

export async function POST(request: Request) {
  try {
    const input = recoverySchema.parse(await request.json());
    const bootstrap = await bootstrapGuestSession(
      getDatabase(),
      await readGuestCredential(),
    );

    if (bootstrap.created) {
      await writeGuestCredential(bootstrap.credential);
    }

    const session = await recoverWorkspace(
      getDatabase(),
      bootstrap.session.guest.id,
      input.recoveryKey,
    );

    return Response.json(session);
  } catch (error) {
    return errorResponse(error);
  }
}
