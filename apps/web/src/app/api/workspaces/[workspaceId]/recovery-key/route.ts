import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { issueWorkspaceRecoveryKey } from "@/lib/guest-service";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const workspaceIdSchema = z.uuid();

export async function POST(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = workspaceIdSchema.parse(rawWorkspaceId);
    const recoveryKey = await issueWorkspaceRecoveryKey(
      getDatabase(),
      await readGuestCredential(),
      workspaceId,
    );

    return Response.json(
      {
        recoveryKey,
        warning: "恢复密钥只显示一次，请立即保存在安全位置。",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
