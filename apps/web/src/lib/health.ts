import { checkDatabaseHealth } from "@collabdocs/db";

import { getDatabase } from "./database";

export type WebReadinessPayload = {
  service: "collabdocs-web";
  status: "ok";
  checks: {
    database: "ok";
  };
};

export async function checkWebReadiness(
  checkDatabase: () => Promise<unknown> = () =>
    checkDatabaseHealth(getDatabase()),
): Promise<WebReadinessPayload> {
  await checkDatabase();

  return {
    service: "collabdocs-web",
    status: "ok",
    checks: {
      database: "ok",
    },
  };
}
