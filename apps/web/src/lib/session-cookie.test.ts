import { describe, expect, it } from "vitest";

import { shouldUseSecureCookies } from "./session-cookie";

describe("session cookie policy", () => {
  it("enables Secure cookies for HTTPS deployments", () => {
    expect(shouldUseSecureCookies("https://docs.example.com")).toBe(true);
  });

  it("allows local and direct HTTP deployments to persist a guest session", () => {
    expect(shouldUseSecureCookies("http://localhost:3000")).toBe(false);
    expect(shouldUseSecureCookies("http://150.158.48.172:3000")).toBe(false);
  });
});
