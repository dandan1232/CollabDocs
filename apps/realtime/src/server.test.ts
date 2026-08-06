import { describe, expect, it } from "vitest";

import { createHealthPayload } from "./server.js";

describe("realtime health payload", () => {
  it("identifies the service as healthy", () => {
    expect(createHealthPayload()).toEqual({
      service: "collabdocs-realtime",
      status: "ok",
    });
  });
});
