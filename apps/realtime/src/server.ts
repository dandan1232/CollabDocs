import { createServer } from "node:http";

const DEFAULT_PORT = 1234;

export function createHealthPayload() {
  return {
    service: "collabdocs-realtime",
    status: "ok",
  } as const;
}

export function createRealtimeServer() {
  return createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(createHealthPayload()));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: "NOT_FOUND" }));
  });
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.REALTIME_PORT ?? DEFAULT_PORT);
  const server = createRealtimeServer();

  server.listen(port, () => {
    console.log(`CollabDocs realtime service listening on port ${port}`);
  });
}
