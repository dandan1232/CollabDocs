import { describe, expect, it } from "vitest";

import {
  importDocumentSource,
  sanitizeDocumentHtml,
} from "./document-transfer";

describe("document transfer", () => {
  it("imports common Markdown structures", () => {
    const html = importDocumentSource(
      "markdown",
      "# 标题\n\n- 第一项\n- **第二项**",
    );
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>第二项</strong>");
  });

  it("removes scripts, handlers, styles and unsafe URLs", () => {
    const html = sanitizeDocumentHtml(
      '<script>alert(1)</script><p style="color:red" onclick="evil()">安全文本</p><a href="javascript:evil()">链接</a>',
    );
    expect(html).toBe("<p>安全文本</p><a>链接</a>");
  });

  it("keeps controlled assets and removes remote imported images", () => {
    const controlled =
      "/api/assets/123e4567-e89b-12d3-a456-426614174000/content";
    const html = sanitizeDocumentHtml(
      `<img src="${controlled}" alt="保留"><img src="https://tracker.example/pixel.png">`,
    );
    expect(html).toContain(controlled);
    expect(html).not.toContain("tracker.example");
  });
});
