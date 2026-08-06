import { createDatabaseClient, type PrismaClient } from "@collabdocs/db";

const globalDatabase = globalThis as typeof globalThis & {
  collabDocsDatabase?: PrismaClient;
};

export function getDatabase(): PrismaClient {
  if (!globalDatabase.collabDocsDatabase) {
    globalDatabase.collabDocsDatabase = createDatabaseClient();
  }

  return globalDatabase.collabDocsDatabase;
}
