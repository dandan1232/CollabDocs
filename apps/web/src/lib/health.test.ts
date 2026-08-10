import { describe, expect, it, vi } from "vitest";

import { checkWebReadiness } from "./health";

describe("web readiness", () => {
  it("reports ready after the database check succeeds", async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);

    await expect(checkWebReadiness(checkDatabase)).resolves.toEqual({
      service: "collabdocs-web",
      status: "ok",
      checks: { database: "ok" },
    });
    expect(checkDatabase).toHaveBeenCalledOnce();
  });

  it("rejects when PostgreSQL is unavailable", async () => {
    await expect(
      checkWebReadiness(async () => {
        throw new Error("database unavailable");
      }),
    ).rejects.toThrow("database unavailable");
  });
});
