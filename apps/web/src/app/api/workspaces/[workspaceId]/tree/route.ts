import { errorResponse } from "@/lib/api-response";
import { getWorkspaceTree } from "@/lib/content-service";
import { getDatabase } from "@/lib/database";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const workspaceIdSchema = z.uuid();
const viewSchema = z.enum(["active", "trash"]).default("active");

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = workspaceIdSchema.parse(rawWorkspaceId);
    const view = viewSchema.parse(
      new URL(request.url).searchParams.get("view") ?? undefined,
    );
    const tree = await getWorkspaceTree(
      getDatabase(),
      await readGuestCredential(),
      workspaceId,
      view,
    );

    return Response.json(tree);
  } catch (error) {
    return errorResponse(error);
  }
}
