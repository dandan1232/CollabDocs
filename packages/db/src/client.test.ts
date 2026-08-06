import { describe, expect, it } from "vitest";

import { getDatabaseUrl } from "./client.js";

describe("database configuration", () => {
  it("returns the configured PostgreSQL URL", () => {
    expect(
      getDatabaseUrl({ DATABASE_URL: "postgresql://localhost/collabdocs" }),
    ).toBe("postgresql://localhost/collabdocs");
  });

  it("rejects missing database configuration", () => {
    expect(() => getDatabaseUrl({})).toThrowError(
      "DATABASE_URL is required to connect to PostgreSQL.",
    );
  });
});
