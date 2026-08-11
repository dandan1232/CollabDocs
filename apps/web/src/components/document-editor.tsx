"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import TiptapImage from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Italic,
  List as ListIcon,
  ListOrdered,
  Minus,
  Paperclip,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

import { requestJson } from "@/lib/client-request";

import { createAuthorAttribution } from "./author-attribution";

export type EditorFont = "sans" | "serif" | "handwriting" | "mono";

export type EditorSnapshot = {
  state: string;
  plainText: string;
};

export type RealtimeUser = {
  id: string;
  name: string;
  color: string;
  avatar: string;
  connectionId?: string;
  attribution?: boolean;
};

export type RealtimeStatus =
  "connecting" | "connected" | "disconnected" | "unauthorized";

export type LocalPersistenceStatus = "loading" | "ready" | "unavailable";

type DocumentEditorProps = {
  documentId: string;
  initialState: string | null;
  fontFamily: EditorFont;
  viewer: RealtimeUser;
  permission: "view" | "edit";
  shareToken?: string;
  onUploadAsset?: (file: File) => Promise<{
    url: string;
    originalName: string;
    mimeType: string;
  }>;
  onChange: (snapshot: EditorSnapshot) => void;
  onBlur: () => void;
  onStatusChange: (status: RealtimeStatus) => void;
  onLocalPersistenceChange: (status: LocalPersistenceStatus) => void;
  onUsersChange: (users: RealtimeUser[]) => void;
  onInspectUser: (user: RealtimeUser) => void;
};

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function getRealtimeUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/realtime`;
}

async function requestRealtimeToken(
  documentId: string,
  shareToken?: string,
): Promise<string> {
  const data = await requestJson<{ token: string }>(
    `/api/realtime/token?documentId=${encodeURIComponent(documentId)}`,
    {
      cache: "no-store",
      headers: shareToken ? { "x-collabdocs-share": shareToken } : undefined,
      timeoutMs: 8_000,
      retries: 1,
    },
  );

  return data.token;
}

export function DocumentEditor({
  documentId,
  initialState,
  fontFamily,
  viewer,
  permission,
  shareToken,
  onUploadAsset,
  onChange,
  onBlur,
  onStatusChange,
  onLocalPersistenceChange,
  onUsersChange,
  onInspectUser,
}: DocumentEditorProps) {
  const yDocument = useMemo(() => {
    const nextDocument = new Y.Doc({ guid: documentId });
    if (initialState) {
      Y.applyUpdate(nextDocument, decodeBase64(initialState));
    }
    return nextDocument;
  }, [documentId, initialState]);

  const provider = useMemo(() => {
    const nextProvider = new HocuspocusProvider({
      url: getRealtimeUrl(),
      name: documentId,
      document: yDocument,
      token: () => requestRealtimeToken(documentId, shareToken),
      flushDelay: 40,
      onStatus: ({ status }) => onStatusChange(status),
      onAuthenticated: () => onStatusChange("connected"),
      onAuthenticationFailed: () => onStatusChange("unauthorized"),
      onAwarenessChange: ({ states }) => {
        const users = new Map<string, RealtimeUser>();
        for (const state of states) {
          const user = state.user as RealtimeUser | undefined;
          if (user?.id) {
            const connectionId = String(state.clientId);
            users.set(connectionId, { ...user, connectionId });
          }
        }
        onUsersChange([...users.values()]);
      },
    });
    nextProvider.setAwarenessField("user", viewer);
    return nextProvider;
  }, [
    documentId,
    onStatusChange,
    onUsersChange,
    shareToken,
    viewer,
    yDocument,
  ]);

  const localPersistence = useMemo(() => {
    try {
      return new IndexeddbPersistence(
        `collabdocs:document:${documentId}`,
        yDocument,
      );
    } catch {
      return null;
    }
  }, [documentId, yDocument]);

  useEffect(() => {
    if (!localPersistence) {
      onLocalPersistenceChange("unavailable");
      return;
    }

    let active = true;
    onLocalPersistenceChange("loading");
    void localPersistence.whenSynced
      .then(() => {
        if (active) onLocalPersistenceChange("ready");
      })
      .catch(() => {
        if (active) onLocalPersistenceChange("unavailable");
      });

    return () => {
      active = false;
    };
  }, [localPersistence, onLocalPersistenceChange]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editable: permission === "edit",
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Link.configure({
          openOnClick: permission === "view",
          autolink: true,
        }),
        TiptapImage.configure({ allowBase64: false }),
        createAuthorAttribution(viewer),
        Collaboration.configure({ document: yDocument }),
        CollaborationCaret.configure({
          provider,
          user: viewer,
          render: (user) => {
            const caret = window.document.createElement("span");
            caret.classList.add("collaboration-carets__caret");
            caret.style.borderColor = user.color;

            const label = window.document.createElement("button");
            label.type = "button";
            label.classList.add("collaboration-carets__label");
            label.style.backgroundColor = user.color;
            label.textContent = user.name;
            label.title = `查看 ${user.name}`;
            label.addEventListener("click", () =>
              onInspectUser(user as RealtimeUser),
            );
            caret.append(label);
            return caret;
          },
        }),
        Placeholder.configure({
          placeholder: "从这里开始。写下想法，稍后邀请伙伴一起补完……",
        }),
      ],
      editorProps: {
        attributes: {
          class: "document-prose",
          spellcheck: "true",
        },
        handleClick: (_view, _position, event) => {
          const target = event.target;
          if (!(target instanceof Element)) return false;
          const authored = target.closest<HTMLElement>("[data-author-id]");
          if (!authored) return false;
          onInspectUser({
            id: authored.dataset.authorId ?? "anonymous",
            name: authored.dataset.authorName ?? "匿名协作者",
            color: authored.dataset.authorColor ?? "#b85c3b",
            avatar: authored.dataset.authorAvatar ?? "/api/avatars/anonymous",
            attribution: true,
          });
          return true;
        },
      },
      onCreate: ({ editor: currentEditor }) => {
        if (permission === "view") return;
        onChange({
          state: encodeBase64(Y.encodeStateAsUpdate(yDocument)),
          plainText: currentEditor.getText({ blockSeparator: "\n" }),
        });
      },
      onUpdate: ({ editor: currentEditor }) => {
        if (permission === "view") return;
        onChange({
          state: encodeBase64(Y.encodeStateAsUpdate(yDocument)),
          plainText: currentEditor.getText({ blockSeparator: "\n" }),
        });
      },
      onBlur,
    },
    [permission, provider, yDocument],
  );

  useEffect(
    () => () => {
      localPersistence?.destroy();
      provider.destroy();
      yDocument.destroy();
    },
    [localPersistence, provider, yDocument],
  );

  return (
    <div className={`document-editor editor-font-${fontFamily}`}>
      {permission === "view" ? (
        <div className="document-readonly-banner">
          只读分享 · 内容更新会实时显示
        </div>
      ) : editor ? (
        <EditorToolbar editor={editor} onUploadAsset={onUploadAsset} />
      ) : (
        <div className="editor-toolbar is-loading" aria-hidden="true" />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function EditorToolbar({
  editor,
  onUploadAsset,
}: {
  editor: Editor;
  onUploadAsset?: DocumentEditorProps["onUploadAsset"];
}) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive("bold") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      strike: currentEditor?.isActive("strike") ?? false,
      code: currentEditor?.isActive("code") ?? false,
      heading1: currentEditor?.isActive("heading", { level: 1 }) ?? false,
      heading2: currentEditor?.isActive("heading", { level: 2 }) ?? false,
      bulletList: currentEditor?.isActive("bulletList") ?? false,
      orderedList: currentEditor?.isActive("orderedList") ?? false,
      blockquote: currentEditor?.isActive("blockquote") ?? false,
      canUndo: currentEditor?.can().undo() ?? false,
      canRedo: currentEditor?.can().redo() ?? false,
    }),
  });

  if (!editor || !state) {
    return <div className="editor-toolbar is-loading" aria-hidden="true" />;
  }

  async function uploadSelectedFile(file: File | undefined) {
    if (!file || !onUploadAsset) return;
    setUploading(true);
    try {
      const asset = await onUploadAsset(file);
      if (asset.mimeType.startsWith("image/")) {
        editor
          .chain()
          .focus()
          .setImage({ src: asset.url, alt: asset.originalName })
          .run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "paragraph",
            content: [
              {
                type: "text",
                text: asset.originalName,
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: asset.url,
                      target: "_blank",
                      rel: "noopener noreferrer nofollow",
                    },
                  },
                ],
              },
            ],
          })
          .run();
      }
    } catch {
      // The parent surfaces the upload error in the document save message.
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="文档格式">
      <ToolbarButton
        label="撤销"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
        icon={<Undo2 size={17} />}
      />
      <ToolbarButton
        label="重做"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
        icon={<Redo2 size={17} />}
      />
      <span className="toolbar-divider" />
      <ToolbarButton
        label="一级标题"
        active={state.heading1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        icon={<Heading1 size={18} />}
      />
      <ToolbarButton
        label="二级标题"
        active={state.heading2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        icon={<Heading2 size={18} />}
      />
      <span className="toolbar-divider" />
      <ToolbarButton
        label="粗体"
        shortcut="Ctrl+B"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
        icon={<Bold size={17} />}
      />
      <ToolbarButton
        label="斜体"
        shortcut="Ctrl+I"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        icon={<Italic size={17} />}
      />
      <ToolbarButton
        label="删除线"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        icon={<Strikethrough size={17} />}
      />
      <ToolbarButton
        label="行内代码"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
        icon={<Code2 size={17} />}
      />
      <span className="toolbar-divider" />
      <ToolbarButton
        label="无序列表"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        icon={<ListIcon size={18} />}
      />
      <ToolbarButton
        label="有序列表"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        icon={<ListOrdered size={18} />}
      />
      <ToolbarButton
        label="引用"
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        icon={<Quote size={17} />}
      />
      <ToolbarButton
        label="分隔线"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        icon={<Minus size={18} />}
      />
      {onUploadAsset ? (
        <>
          <span className="toolbar-divider" />
          <ToolbarButton
            label={uploading ? "正在上传附件" : "插入图片或附件"}
            disabled={uploading}
            onClick={() => uploadInputRef.current?.click()}
            icon={<Paperclip className={uploading ? "spin" : ""} size={18} />}
          />
          <input
            ref={uploadInputRef}
            className="sr-only"
            type="file"
            accept="image/avif,image/gif,image/jpeg,image/png,image/webp,application/pdf,application/zip,text/plain,text/markdown,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            onChange={(event) =>
              void uploadSelectedFile(event.currentTarget.files?.[0])
            }
          />
        </>
      ) : null}
    </div>
  );
}

function ToolbarButton({
  label,
  shortcut,
  icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const title = shortcut ? `${label}（${shortcut}）` : label;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={active ? "is-active" : ""}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
