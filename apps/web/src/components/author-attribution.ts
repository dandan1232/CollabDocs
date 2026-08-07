import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

import type { RealtimeUser } from "./document-editor";

const attributionPluginKey = new PluginKey("author-attribution");
const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

function safeColor(color: string) {
  return SAFE_COLOR.test(color) ? color : "#b85c3b";
}

function containsInsertedText(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ("text" in value && typeof value.text === "string" && value.text) {
    return true;
  }
  return Object.values(value).some(containsInsertedText);
}

export function createAuthorAttribution(viewer: RealtimeUser) {
  return Mark.create({
    name: "authorAttribution",
    inclusive: false,
    addAttributes() {
      return {
        authorId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-author-id"),
        },
        authorName: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-author-name"),
        },
        authorColor: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-author-color"),
        },
        authorAvatar: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-author-avatar"),
        },
      };
    },
    parseHTML() {
      return [{ tag: "span[data-author-id]" }];
    },
    renderHTML({ HTMLAttributes }) {
      const name = String(HTMLAttributes.authorName ?? "匿名协作者");
      const color = safeColor(String(HTMLAttributes.authorColor ?? ""));
      return [
        "span",
        mergeAttributes(HTMLAttributes, {
          class: "authored-text",
          "data-author-id": HTMLAttributes.authorId,
          "data-author-name": name,
          "data-author-color": color,
          "data-author-avatar": HTMLAttributes.authorAvatar,
          style: `--author-color: ${color}`,
          title: `${name} 写下`,
        }),
        0,
      ];
    },
    addProseMirrorPlugins() {
      const markType = this.type;
      const attributes = {
        authorId: viewer.id,
        authorName: viewer.name,
        authorColor: safeColor(viewer.color),
        authorAvatar: viewer.avatar,
      };

      return [
        new Plugin({
          key: attributionPluginKey,
          appendTransaction(transactions, oldState, newState) {
            const localTransactions = transactions.filter(
              (transaction) =>
                transaction.docChanged &&
                !transaction.getMeta(attributionPluginKey) &&
                !transaction.getMeta(ySyncPluginKey)?.isChangeOrigin &&
                transaction.steps.some((step) =>
                  containsInsertedText(step.toJSON()),
                ),
            );
            if (localTransactions.length === 0) return null;

            const start = oldState.doc.content.findDiffStart(
              newState.doc.content,
            );
            const end = oldState.doc.content.findDiffEnd(newState.doc.content);
            if (start === null || !end || end.b <= start) return null;

            const transaction = newState.tr.setMeta(attributionPluginKey, true);
            const authorMark = markType.create(attributes);
            newState.doc.nodesBetween(start, end.b, (node, position) => {
              if (!node.isText) return;
              const from = Math.max(start, position);
              const to = Math.min(end.b, position + node.nodeSize);
              if (from < to) transaction.addMark(from, to, authorMark);
            });

            return transaction.steps.length > 0 ? transaction : null;
          },
        }),
      ];
    },
  });
}
