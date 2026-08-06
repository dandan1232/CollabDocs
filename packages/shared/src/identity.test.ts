import { describe, expect, it } from "vitest";

import { generateGuestProfile, renderGuestAvatar } from "./identity.js";

describe("guest identity", () => {
  it("generates a stable Chinese nickname, avatar seed, and presence color", () => {
    const first = generateGuestProfile("collabdocs-test-seed");
    const second = generateGuestProfile("collabdocs-test-seed");

    expect(first).toEqual(second);
    expect(first.nickname).toMatch(/^[\u4e00-\u9fa5]+$/u);
    expect(first.avatarSeed).toBe("collabdocs-test-seed");
    expect(first.presenceColor).toMatch(/^#[0-9A-F]{6}$/u);
  });

  it("renders a deterministic DiceBear SVG without a remote dependency", () => {
    const svg = renderGuestAvatar("collabdocs-test-seed");

    expect(svg).toContain("<svg");
    expect(svg).toContain('width="128"');
    expect(renderGuestAvatar("collabdocs-test-seed")).toBe(svg);
  });
});
