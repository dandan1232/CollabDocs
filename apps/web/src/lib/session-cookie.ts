import { cookies } from "next/headers";

export const GUEST_SESSION_COOKIE = "collabdocs_guest";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function readGuestCredential(): Promise<string | undefined> {
  return (await cookies()).get(GUEST_SESSION_COOKIE)?.value;
}

export async function writeGuestCredential(credential: string): Promise<void> {
  (await cookies()).set(GUEST_SESSION_COOKIE, credential, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    priority: "high",
  });
}
