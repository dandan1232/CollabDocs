import { errorResponse } from "@/lib/api-response";
import { getDatabase } from "@/lib/database";
import { updateGuestProfile } from "@/lib/guest-service";
import { readGuestCredential } from "@/lib/session-cookie";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const profileSchema = z
  .object({
    nickname: z.string().trim().min(1).max(32).optional(),
    randomizeAvatar: z.boolean().optional(),
  })
  .refine((profile) => profile.nickname || profile.randomizeAvatar, {
    message: "至少需要修改一项访客资料。",
  });

export async function PATCH(request: Request) {
  try {
    const input = profileSchema.parse(await request.json());
    const session = await updateGuestProfile(
      getDatabase(),
      await readGuestCredential(),
      {
        ...(input.nickname ? { nickname: input.nickname } : {}),
        ...(input.randomizeAvatar ? { avatarSeed: randomUUID() } : {}),
      },
    );

    return Response.json(session);
  } catch (error) {
    return errorResponse(error);
  }
}
