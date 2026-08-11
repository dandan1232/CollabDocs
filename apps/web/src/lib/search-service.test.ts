import { describe, expect, it } from "vitest";

import { compactSearchSnippet, escapeLikePattern } from "./search-service";

describe("compactSearchSnippet", () => {
  it("collapses editor whitespace into a readable excerpt", () => {
    expect(compactSearchSnippet("  第一段\n\n  第二段\t结尾  ")).toBe(
      "第一段 第二段 结尾",
    );
  });

  it("keeps Chinese and emoji content intact", () => {
    expect(compactSearchSnippet("协作 🌱 文档")).toBe("协作 🌱 文档");
  });
});

describe("escapeLikePattern", () => {
  it("treats SQL wildcard characters as literal search text", () => {
    expect(escapeLikePattern("100%_完成\\草稿")).toBe("100\\%\\_完成\\\\草稿");
  });
});
