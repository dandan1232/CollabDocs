import { renderGuestAvatar } from "@collabdocs/shared";

export async function GET(
  _request: Request,
  context: { params: Promise<{ seed: string }> },
) {
  const { seed: rawSeed } = await context.params;
  const seed = decodeURIComponent(rawSeed);

  if (!seed || seed.length > 128) {
    return Response.json(
      { error: { code: "INVALID_AVATAR_SEED", message: "头像参数无效。" } },
      { status: 400 },
    );
  }

  return new Response(renderGuestAvatar(seed), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
