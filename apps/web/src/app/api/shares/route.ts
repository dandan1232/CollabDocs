import { SharePermission } from "@collabdocs/db";

import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { issueDocumentShareLink } from "@/lib/share-service";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const shareSchema = z.object({
  documentId: z.uuid(),
  permission: z.enum(["view", "edit"]),
});

export async function POST(request: Request) {
  try {
    const input = shareSchema.parse(await request.json());
    const share = await issueDocumentShareLink(
      getDatabase(),
      await readGuestCredential(),
      input.documentId,
      input.permission === "edit" ? SharePermission.EDIT : SharePermission.VIEW,
    );

    return Response.json(share, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
