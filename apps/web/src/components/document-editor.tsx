"use client";

import Collaboration from "@tiptap/extension-collaboration";
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
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import * as Y from "yjs";

export type EditorFont = "sans" | "serif" | "handwriting" | "mono";

export type EditorSnapshot = {
  state: string;
  plainText: string;
};

type DocumentEditorProps = {
  documentId: string;
  initialState: string | null;
  fontFamily: EditorFont;
  onChange: (snapshot: EditorSnapshot) => void;
  onBlur: () => void;
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

export function DocumentEditor({
  documentId,
  initialState,
  fontFamily,
  onChange,
  onBlur,
}: DocumentEditorProps) {
  const yDocument = useMemo(() => {
    const nextDocument = new Y.Doc({ guid: documentId });
    if (initialState) {
      Y.applyUpdate(nextDocument, decodeBase64(initialState));
    }
    return nextDocument;
  }, [documentId, initialState]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: yDocument }),
        Placeholder.configure({
          placeholder: "从这里开始。写下想法，稍后邀请伙伴一起补完……",
        }),
      ],
      editorProps: {
        attributes: {
          class: "document-prose",
          spellcheck: "true",
        },
      },
      onCreate: ({ editor: currentEditor }) => {
        onChange({
          state: encodeBase64(Y.encodeStateAsUpdate(yDocument)),
          plainText: currentEditor.getText({ blockSeparator: "\n" }),
        });
      },
      onUpdate: ({ editor: currentEditor }) => {
        onChange({
          state: encodeBase64(Y.encodeStateAsUpdate(yDocument)),
          plainText: currentEditor.getText({ blockSeparator: "\n" }),
        });
      },
      onBlur,
    },
    [yDocument],
  );

  useEffect(
    () => () => {
      yDocument.destroy();
    },
    [yDocument],
  );

  return (
    <div className={`document-editor editor-font-${fontFamily}`}>
      {editor ? (
        <EditorToolbar editor={editor} />
      ) : (
        <div className="editor-toolbar is-loading" aria-hidden="true" />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function EditorToolbar({ editor }: { editor: Editor }) {
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
