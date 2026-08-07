import { Server } from "@hocuspocus/server";
import { createDatabaseClient, type PrismaClient } from "@collabdocs/db";
import * as Y from "yjs";

const DEFAULT_PORT = 1234;
const DEFAULT_INTERNAL_WEB_URL = "http://web:3000";
const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RealtimeUser = {
  id: string;
  nickname: string;
  avatarUrl: string;
  presenceColor: string;
  readOnly: boolean;
};

type RealtimeContext = {
  user: RealtimeUser;
};

type Fetcher = typeof fetch;

export type RealtimePersistence = {
  load(documentId: string): Promise<Uint8Array | null>;
  store(documentId: string, state: Uint8Array): Promise<void>;
};

export function createPostgresPersistence(
  database: PrismaClient = createDatabaseClient(),
): RealtimePersistence {
  return {
    async load(documentId) {
      const collaboration = await database.collaborationState.findUnique({
        where: { documentId },
        select: { state: true },
      });
      return collaboration ? new Uint8Array(collaboration.state) : null;
    },
    async store(documentId, state) {
      await database.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${documentId}))`;
        const current = await transaction.collaborationState.findUnique({
          where: { documentId },
          select: { state: true },
        });
        const mergedState = Uint8Array.from(
          current
            ? Y.mergeUpdates([new Uint8Array(current.state), state])
            : state,
        );

        await transaction.collaborationState.upsert({
          where: { documentId },
          create: {
            documentId,
            state: mergedState,
            schemaVersion: 1,
          },
          update: {
            state: mergedState,
            schemaVersion: 1,
          },
        });
      });
    },
  };
}

export async function loadDocumentState(
  persistence: RealtimePersistence,
  documentId: string,
) {
  return (await persistence.load(documentId)) ?? undefined;
}

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
  persistence: RealtimePersistence = createPostgresPersistence(),
) {
  return new Server<RealtimeContext>({
    name: "collabdocs-realtime",
    port: Number(process.env.REALTIME_PORT ?? DEFAULT_PORT),
    quiet: true,
    debounce: 2_000,
    maxDebounce: 10_000,
    timeout: 30_000,
    websocketOptions: { maxPayload: 2 * 1024 * 1024 },
    async onAuthenticate({ token, documentName, connectionConfig }) {
      const context = await authorizeConnection(
        internalWebUrl,
        token,
        documentName,
        fetcher,
      );
      connectionConfig.readOnly = context.user.readOnly;
      return context;
    },
    async onLoadDocument({ documentName }) {
      return loadDocumentState(persistence, documentName);
    },
    async onStoreDocument({ documentName, document }) {
      await persistence.store(documentName, Y.encodeStateAsUpdate(document));
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
