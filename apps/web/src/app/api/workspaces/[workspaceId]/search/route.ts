import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { searchWorkspace } from "@/lib/search-service";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const workspaceIdSchema = z.uuid();
const querySchema = z.string().trim().min(1).max(100);

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = workspaceIdSchema.parse(rawWorkspaceId);
    const query = querySchema.parse(
      new URL(request.url).searchParams.get("query") ?? "",
    );
    const results = await searchWorkspace(
      getDatabase(),
      await readGuestCredential(),
      workspaceId,
      query,
    );

    return Response.json(results);
  } catch (error) {
    return errorResponse(error);
  }
}
