"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Cloud,
  CloudOff,
  HardDrive,
  LoaderCircle,
  Maximize2,
  Moon,
  PenLine,
  RefreshCw,
  Sun,
  Type,
  Wifi,
  WifiOff,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import {
  DocumentEditor,
  type EditorFont,
  type EditorSnapshot,
  type LocalPersistenceStatus,
  type RealtimeStatus,
  type RealtimeUser,
} from "./document-editor";

type EditorDocument = {
  id: string;
  title: string;
  fontFamily: EditorFont;
  isWide: boolean;
  plainText: string;
  contentVersion: number;
  updatedAt: string;
  state: string | null;
  folder: { id: string; name: string } | null;
  workspace: { id: string; name: string; type: "personal" | "team" };
  viewer: {
    id: string;
    nickname: string;
    avatarUrl: string;
    presenceColor: string;
  };
};

type SavedDocument = Pick<
  EditorDocument,
  "id" | "title" | "fontFamily" | "isWide" | "contentVersion" | "updatedAt"
>;

type SaveDraft = EditorSnapshot & {
  title: string;
  fontFamily: EditorFont;
  isWide: boolean;
};

type SaveStatus =
  | "loading"
  | "pending"
  | "saving"
  | "saved"
  | "offline"
  | "error"
  | "conflict";

class RequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await response.json()) as T & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new RequestError(
      data.error?.message ?? "文档请求失败，请稍后重试。",
      response.status,
    );
  }

  return data;
}

const fontOptions: Array<{
  value: EditorFont;
  label: string;
}> = [
  { value: "sans", label: "现代黑体" },
  { value: "serif", label: "书刊宋体" },
  { value: "handwriting", label: "霞鹜文楷" },
  { value: "mono", label: "等宽代码" },
];

export function DocumentStudio({
  documentId,
  dark,
  onToggleTheme,
  onClose,
}: {
  documentId: string;
  dark: boolean;
  onToggleTheme: () => void;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [fontFamily, setFontFamily] = useState<EditorFont>("sans");
  const [isWide, setIsWide] = useState(false);
  const [characterCount, setCharacterCount] = useState(0);
  const [contentVersion, setContentVersion] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [saveMessage, setSaveMessage] = useState("正在展开文档…");
  const [realtimeStatus, setRealtimeStatus] =
    useState<RealtimeStatus>("connecting");
  const [localPersistenceStatus, setLocalPersistenceStatus] =
    useState<LocalPersistenceStatus>("loading");
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [realtimeUsers, setRealtimeUsers] = useState<RealtimeUser[]>([]);
  const [inspectedUser, setInspectedUser] = useState<RealtimeUser | null>(null);

  const draftRef = useRef<SaveDraft | null>(null);
  const versionRef = useRef(0);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const savingRef = useRef(false);
  const retryAfterSaveRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const viewerId = document?.viewer.id;
  const viewerName = document?.viewer.nickname;
  const viewerColor = document?.viewer.presenceColor;
  const viewerAvatar = document?.viewer.avatarUrl;

  const realtimeViewer = useMemo<RealtimeUser | null>(
    () =>
      viewerId && viewerName && viewerColor && viewerAvatar
        ? {
            id: viewerId,
            name: viewerName,
            color: viewerColor,
            avatar: viewerAvatar,
          }
        : null,
    [viewerAvatar, viewerColor, viewerId, viewerName],
  );

  const flushSave = useCallback(async () => {
    const draft = draftRef.current;
    if (!draft || revisionRef.current === savedRevisionRef.current) return;

    if (!navigator.onLine) {
      setSaveStatus("offline");
      setSaveMessage("已安全保存在此设备，联网后自动同步");
      return;
    }

    if (savingRef.current) {
      retryAfterSaveRef.current = true;
      return;
    }

    savingRef.current = true;
    retryAfterSaveRef.current = false;
    const savingRevision = revisionRef.current;
    const expectedVersion = versionRef.current;
    setSaveStatus("saving");
    setSaveMessage("正在保存到云端…");

    try {
      const saved = await requestJson<SavedDocument>(
        `/api/documents/${documentId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...draft,
            expectedVersion,
          }),
        },
      );
      versionRef.current = saved.contentVersion;
      setContentVersion(saved.contentVersion);
      savedRevisionRef.current = savingRevision;
      setDocument((current) =>
        current
          ? {
              ...current,
              ...saved,
            }
          : current,
      );

      if (revisionRef.current === savingRevision) {
        setSaveStatus("saved");
        setSaveMessage("所有更改已保存");
      } else {
        retryAfterSaveRef.current = true;
      }
    } catch (error) {
      if (!navigator.onLine) {
        setSaveStatus("offline");
        setSaveMessage("已安全保存在此设备，联网后自动同步");
        return;
      }
      const conflict = error instanceof RequestError && error.status === 409;
      setSaveStatus(conflict ? "conflict" : "error");
      setSaveMessage(
        error instanceof Error ? error.message : "保存失败，请稍后重试。",
      );
    } finally {
      savingRef.current = false;
      if (retryAfterSaveRef.current) {
        retryAfterSaveRef.current = false;
        saveTimerRef.current = setTimeout(
          () => void flushSaveRef.current(),
          120,
        );
      }
    }
  }, [documentId]);

  useEffect(() => {
    flushSaveRef.current = flushSave;
  }, [flushSave]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      setSaveStatus("pending");
      setSaveMessage("网络已恢复，正在同步离线更改…");
      void flushSaveRef.current();
    };
    const handleOffline = () => {
      setOnline(false);
      setSaveStatus("offline");
      setSaveMessage("已安全保存在此设备，联网后自动同步");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const queueSave = useCallback(
    (patch: Partial<SaveDraft>) => {
      if (!draftRef.current) return;
      draftRef.current = { ...draftRef.current, ...patch };
      revisionRef.current += 1;
      if (!navigator.onLine) {
        setSaveStatus("offline");
        setSaveMessage("已安全保存在此设备，联网后自动同步");
        return;
      }
      setSaveStatus("pending");
      setSaveMessage("有更改等待保存");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => void flushSave(), 850);
    },
    [flushSave],
  );

  const loadDocument = useCallback(
    (signal?: AbortSignal) => {
      setLoadError(null);
      setSaveStatus("loading");
      setSaveMessage("正在展开文档…");
      return requestJson<EditorDocument>(`/api/documents/${documentId}`, {
        signal,
      })
        .then((nextDocument) => {
          setDocument(nextDocument);
          setTitle(nextDocument.title);
          setFontFamily(nextDocument.fontFamily);
          setIsWide(nextDocument.isWide);
          setCharacterCount(nextDocument.plainText.replace(/\s/g, "").length);
          versionRef.current = nextDocument.contentVersion;
          setContentVersion(nextDocument.contentVersion);
          revisionRef.current = 0;
          savedRevisionRef.current = 0;
          draftRef.current = nextDocument.state
            ? {
                title: nextDocument.title,
                fontFamily: nextDocument.fontFamily,
                isWide: nextDocument.isWide,
                state: nextDocument.state,
                plainText: nextDocument.plainText,
              }
            : null;
          setSaveStatus("saved");
          setSaveMessage("所有更改已保存");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setLoadError(
            error instanceof Error ? error.message : "文档加载失败。",
          );
          setSaveStatus("error");
          setSaveMessage("文档加载失败");
        });
    },
    [documentId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      void loadDocument(controller.signal);
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [loadDocument]);

  useEffect(() => {
    function saveWithShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        void flushSave();
      }
    }

    window.addEventListener("keydown", saveWithShortcut);
    return () => window.removeEventListener("keydown", saveWithShortcut);
  }, [flushSave]);

  const handleEditorChange = useCallback(
    (snapshot: EditorSnapshot) => {
      setCharacterCount(snapshot.plainText.replace(/\s/g, "").length);
      if (!draftRef.current && document) {
        draftRef.current = {
          title: document.title,
          fontFamily: document.fontFamily,
          isWide: document.isWide,
          ...snapshot,
        };
      }
      queueSave(snapshot);
    },
    [document, queueSave],
  );

  function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextTitle = event.target.value;
    setTitle(nextTitle);
    if (nextTitle.trim()) queueSave({ title: nextTitle.trim() });
  }

  function handleFontChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextFont = event.target.value as EditorFont;
    setFontFamily(nextFont);
    queueSave({ fontFamily: nextFont });
  }

  function toggleWidePage() {
    const nextWide = !isWide;
    setIsWide(nextWide);
    queueSave({ isWide: nextWide });
  }

  async function closeEditor() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await flushSave();
    onClose();
  }

  if (loadError) {
    return (
      <main className="editor-fallback">
        <div>
          <AlertTriangle size={28} />
          <h1>这张纸暂时没有展开</h1>
          <p>{loadError}</p>
          <div>
            <button className="secondary-button" onClick={onClose}>
              返回工作台
            </button>
            <button
              className="primary-button"
              onClick={() => void loadDocument()}
            >
              <RefreshCw size={16} />
              重新加载
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!document) {
    return (
      <main className="editor-fallback is-loading">
        <LoaderCircle className="spin" size={26} />
        <p>正在展开你的纸张…</p>
      </main>
    );
  }

  return (
    <main className="editor-studio">
      <header className="editor-topbar">
        <button
          className="icon-button editor-back"
          onClick={() => void closeEditor()}
          aria-label="返回工作台"
        >
          <ArrowLeft size={19} />
        </button>
        <div className="editor-breadcrumbs">
          <span>{document.workspace.name}</span>
          {document.folder ? (
            <>
              <ChevronRight size={14} />
              <span>{document.folder.name}</span>
            </>
          ) : null}
          <ChevronRight size={14} />
          <strong>{title || "无标题文档"}</strong>
        </div>
        <button
          className={`save-state save-${saveStatus}`}
          onClick={() => void flushSave()}
          title={saveMessage}
        >
          <SaveIcon status={saveStatus} />
          <span>{saveMessage}</span>
        </button>
        <div className="editor-presence" aria-label="当前在线成员">
          <span>{Math.max(1, realtimeUsers.length)} 人在线</span>
          <div className="presence-avatars">
            {(realtimeUsers.length > 0
              ? realtimeUsers
              : realtimeViewer
                ? [realtimeViewer]
                : []
            )
              .slice(0, 4)
              .map((user) => (
                <button
                  key={user.id}
                  onClick={() => setInspectedUser(user)}
                  title={`查看 ${user.name}`}
                >
                  <Image
                    src={user.avatar}
                    alt={user.name}
                    width={32}
                    height={32}
                    unoptimized
                  />
                </button>
              ))}
          </div>
        </div>
        <button
          className="icon-button"
          onClick={onToggleTheme}
          aria-label="切换明暗主题"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <section className="editor-controls" aria-label="文档设置">
        <label className="font-picker">
          {fontFamily === "handwriting" ? (
            <PenLine size={16} />
          ) : (
            <Type size={16} />
          )}
          <span className="sr-only">文档字体</span>
          <select value={fontFamily} onChange={handleFontChange}>
            {fontOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={isWide ? "is-active" : ""}
          onClick={toggleWidePage}
          aria-pressed={isWide}
        >
          <Maximize2 size={16} />
          宽页面
        </button>
        <span
          className={`realtime-state state-${online ? realtimeStatus : "offline"}`}
        >
          {online && realtimeStatus === "connected" ? (
            <Wifi size={14} />
          ) : (
            <WifiOff size={14} />
          )}
          {!online
            ? "离线编辑中"
            : realtimeStatus === "connected"
            ? "实时协作已连接"
            : realtimeStatus === "connecting"
              ? "正在连接实时协作"
              : realtimeStatus === "unauthorized"
                ? "协作授权已失效"
                : "实时协作已断开"}
        </span>
        <span
          className={`local-copy-state state-${localPersistenceStatus}`}
          title="文档副本保存在当前浏览器的 IndexedDB 中"
        >
          <HardDrive size={14} />
          {localPersistenceStatus === "ready"
            ? "本机副本已就绪"
            : localPersistenceStatus === "loading"
              ? "正在准备本机副本"
              : "本机副本不可用"}
        </span>
      </section>

      <section className={`document-page ${isWide ? "is-wide" : ""}`}>
        <div className="document-heading-block">
          <span className="document-kicker">COLLABORATIVE NOTE</span>
          <input
            value={title}
            onChange={handleTitleChange}
            onBlur={() => void flushSave()}
            maxLength={240}
            aria-label="文档标题"
            placeholder="无标题文档"
          />
          <div className="document-byline">
            <button
              className="author-inspect"
              onClick={() =>
                realtimeViewer ? setInspectedUser(realtimeViewer) : undefined
              }
            >
              <span
                className="author-rule"
                style={{ backgroundColor: document.viewer.presenceColor }}
              />
              <span>{document.viewer.nickname} 正在书写</span>
            </button>
            <span>·</span>
            <span>版本 {contentVersion}</span>
          </div>
        </div>

        {realtimeViewer ? (
          <DocumentEditor
            documentId={document.id}
            initialState={document.state}
            fontFamily={fontFamily}
            viewer={realtimeViewer}
            onChange={handleEditorChange}
            onBlur={() => void flushSave()}
            onStatusChange={setRealtimeStatus}
            onLocalPersistenceChange={setLocalPersistenceStatus}
            onUsersChange={setRealtimeUsers}
            onInspectUser={setInspectedUser}
          />
        ) : null}

        <footer className="document-footer">
          <span>{characterCount} 字</span>
          <span>
            {online
              ? "自动保存 · Ctrl/⌘ + S 立即保存"
              : "离线更改保存在本机 · 联网后自动合并"}
          </span>
        </footer>
      </section>

      {inspectedUser ? (
        <div className="presence-card" role="dialog" aria-label="协作者信息">
          <button
            className="presence-card-close"
            onClick={() => setInspectedUser(null)}
            aria-label="关闭协作者信息"
          >
            ×
          </button>
          <Image
            src={inspectedUser.avatar}
            alt=""
            width={48}
            height={48}
            unoptimized
          />
          <div>
            <strong>{inspectedUser.name}</strong>
            <span>
              <i style={{ backgroundColor: inspectedUser.color }} />
              正在这篇文档中
            </span>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function SaveIcon({ status }: { status: SaveStatus }) {
  if (status === "saving" || status === "loading") {
    return <LoaderCircle className="spin" size={15} />;
  }
  if (status === "error" || status === "conflict") {
    return <AlertTriangle size={15} />;
  }
  if (status === "offline") return <CloudOff size={15} />;
  if (status === "saved") return <Check size={15} />;
  return <Cloud size={15} />;
}
