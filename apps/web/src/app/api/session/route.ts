import { getDatabase } from "@/lib/database";
import { errorResponse } from "@/lib/api-response";
import {
  bootstrapGuestSession,
  requireGuestSession,
} from "@/lib/guest-service";
import {
  readGuestCredential,
  writeGuestCredential,
} from "@/lib/session-cookie";

export async function GET() {
  try {
    const session = await requireGuestSession(
      getDatabase(),
      await readGuestCredential(),
    );

    return Response.json(session);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST() {
  try {
    const result = await bootstrapGuestSession(
      getDatabase(),
      await readGuestCredential(),
    );

    if (result.created) {
      await writeGuestCredential(result.credential);
    }

    return Response.json(result.session, {
      status: result.created ? 201 : 200,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
