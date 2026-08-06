import { cookies } from "next/headers";

export const GUEST_SESSION_COOKIE = "collabdocs_guest";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function shouldUseSecureCookies(applicationUrl?: string): boolean {
  if (!applicationUrl) {
    return process.env.NODE_ENV === "production";
  }

  try {
    return new URL(applicationUrl).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

export async function readGuestCredential(): Promise<string | undefined> {
  return (await cookies()).get(GUEST_SESSION_COOKIE)?.value;
}

export async function writeGuestCredential(credential: string): Promise<void> {
  (await cookies()).set(GUEST_SESSION_COOKIE, credential, {
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookies(process.env.APP_URL),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    priority: "high",
  });
}
