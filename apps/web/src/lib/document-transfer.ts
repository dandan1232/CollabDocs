import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export type DocumentImportFormat = "markdown" | "html";

const controlledAssetPattern =
  /^\/api\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/content$/iu;

export function sanitizeDocumentHtml(source: string): string {
  return sanitizeHtml(source, {
    allowedTags: [
      "p",
      "h1",
      "h2",
      "h3",
      "blockquote",
      "ul",
      "ol",
      "li",
      "pre",
      "code",
      "strong",
      "em",
      "s",
      "a",
      "img",
      "hr",
      "br",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          ...(attributes.target === "_blank"
            ? { rel: "noopener noreferrer nofollow" }
            : {}),
        },
      }),
    },
    exclusiveFilter: (frame) =>
      frame.tag === "img" &&
      !controlledAssetPattern.test(frame.attribs.src ?? ""),
  });
}

export function importDocumentSource(
  format: DocumentImportFormat,
  source: string,
): string {
  const html =
    format === "markdown"
      ? marked.parse(source, { async: false, gfm: true })
      : source;
  return sanitizeDocumentHtml(html);
}
