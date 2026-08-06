import "dotenv/config";

import { defineConfig } from "prisma/config";

const localDatabaseUrl =
  "postgresql://collabdocs:collabdocs@localhost:5432/collabdocs?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Schema generation and formatting should also work before `.env` exists.
    url: process.env.DATABASE_URL ?? localDatabaseUrl,
  },
});
