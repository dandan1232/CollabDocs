import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

type DatabaseEnvironment = Record<string, string | undefined>;

export function getDatabaseUrl(
  environment: DatabaseEnvironment = process.env,
): string {
  const databaseUrl = environment.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
  }

  return databaseUrl;
}

export function createDatabaseClient(databaseUrl = getDatabaseUrl()) {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    max: 10,
  });

  return new PrismaClient({ adapter });
}

export async function checkDatabaseHealth(
  client: PrismaClient,
): Promise<{ status: "ok"; timestamp: Date }> {
  const [result] = await client.$queryRaw<Array<{ timestamp: Date }>>`
    SELECT CURRENT_TIMESTAMP AS timestamp
  `;

  if (!result) {
    throw new Error("PostgreSQL health check returned no result.");
  }

  return {
    status: "ok",
    timestamp: result.timestamp,
  };
}
