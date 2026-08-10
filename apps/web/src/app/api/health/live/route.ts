const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

export async function GET() {
  return Response.json(
    {
      service: "collabdocs-web",
      status: "ok",
    },
    { headers },
  );
}
