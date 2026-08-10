import { checkWebReadiness } from "@/lib/health";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

export async function GET() {
  try {
    return Response.json(await checkWebReadiness(), { headers });
  } catch (error) {
    console.error("Web readiness check failed", error);
    return Response.json(
      {
        service: "collabdocs-web",
        status: "unavailable",
        checks: {
          database: "unavailable",
        },
      },
      { status: 503, headers },
    );
  }
}
