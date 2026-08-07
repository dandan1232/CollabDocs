import { Server } from "@hocuspocus/server";

const DEFAULT_PORT = 1234;
const DEFAULT_INTERNAL_WEB_URL = "http://web:3000";
const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RealtimeUser = {
  id: string;
  nickname: string;
  avatarUrl: string;
  presenceColor: string;
};

type RealtimeContext = {
  user: RealtimeUser;
};

type Fetcher = typeof fetch;

export function createHealthPayload() {
  return {
    service: "collabdocs-realtime",
    status: "ok",
  } as const;
}

export async function authorizeConnection(
  internalWebUrl: string,
  token: string,
  documentId: string,
  fetcher: Fetcher = fetch,
): Promise<RealtimeContext> {
  if (!DOCUMENT_ID_PATTERN.test(documentId) || !token) {
    throw new Error("Realtime authorization rejected.");
  }

  const response = await fetcher(
    new URL("/api/realtime/authorize", internalWebUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, documentId }),
      signal: AbortSignal.timeout(5_000),
    },
  );

  if (!response.ok) {
    throw new Error("Realtime authorization rejected.");
  }

  return (await response.json()) as RealtimeContext;
}

export function createRealtimeServer(
  internalWebUrl = process.env.INTERNAL_WEB_URL ?? DEFAULT_INTERNAL_WEB_URL,
  fetcher: Fetcher = fetch,
) {
  return new Server<RealtimeContext>({
    name: "collabdocs-realtime",
    port: Number(process.env.REALTIME_PORT ?? DEFAULT_PORT),
    quiet: true,
    debounce: 2_000,
    maxDebounce: 10_000,
    timeout: 30_000,
    websocketOptions: { maxPayload: 2 * 1024 * 1024 },
    async onAuthenticate({ token, documentName }) {
      return authorizeConnection(internalWebUrl, token, documentName, fetcher);
    },
    async onRequest({ request, response }) {
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(createHealthPayload()));
        throw null;
      }
    },
  });
}

if (process.env.NODE_ENV !== "test") {
  const server = createRealtimeServer();
  void server.listen().then(() => {
    console.log(
      `CollabDocs realtime service listening on port ${server.address.port}`,
    );
  });
}
