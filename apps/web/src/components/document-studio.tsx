"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Cloud,
  CloudOff,
  Copy,
  Eye,
  HardDrive,
  LoaderCircle,
  Maximize2,
  Moon,
  PenLine,
  RefreshCw,
  Share2,
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
  isRetriableRequestError,
  RequestError,
  requestJson,
} from "@/lib/client-request";

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
  access: {
    permission: "view" | "edit";
    canShare: boolean;
  };
};

type ShareDetails = {
  token: string;
  documentTitle: string;
  permission: "view" | "edit";
  expiresAt: string;
};

type UploadedAsset = {
  url: string;
  originalName: string;
  mimeType: string;
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
  "loading" | "pending" | "saving" | "saved" | "offline" | "error" | "conflict";

const SAVE_RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000] as const;

const fallbackMimeTypes: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

function fileMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return fallbackMimeTypes[extension] ?? "application/octet-stream";
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
  shareToken,
  dark,
  onToggleTheme,
  onClose,
}: {
  documentId: string;
  shareToken?: string;
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
  const [sharePermission, setSharePermission] = useState<"view" | "edit">(
    "edit",
  );
  const [shareDetails, setShareDetails] = useState<ShareDetails | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const draftRef = useRef<SaveDraft | null>(null);
  const versionRef = useRef(0);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const savingRef = useRef(false);
  const retryAfterSaveRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRetryAttemptRef = useRef(0);
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
          headers: shareToken
            ? { "x-collabdocs-share": shareToken }
            : undefined,
          timeoutMs: 8_000,
          retries: 2,
          retryDelayMs: 400,
        },
      );
      if (saveRetryTimerRef.current) {
        clearTimeout(saveRetryTimerRef.current);
        saveRetryTimerRef.current = null;
      }
      saveRetryAttemptRef.current = 0;
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
      const message =
        error instanceof Error ? error.message : "保存失败，请稍后重试。";
      if (!conflict && isRetriableRequestError(error)) {
        const retryIndex = Math.min(
          saveRetryAttemptRef.current,
          SAVE_RETRY_DELAYS_MS.length - 1,
        );
        const retryDelay = SAVE_RETRY_DELAYS_MS[retryIndex];
        saveRetryAttemptRef.current += 1;
        if (saveRetryTimerRef.current) {
          clearTimeout(saveRetryTimerRef.current);
        }
        saveRetryTimerRef.current = setTimeout(
          () => void flushSaveRef.current(),
          retryDelay,
        );
        setSaveMessage(
          `${message} 将在 ${Math.ceil(retryDelay / 1000)} 秒后自动重试。`,
        );
      } else {
        setSaveMessage(message);
      }
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
  }, [documentId, shareToken]);

  useEffect(() => {
    flushSaveRef.current = flushSave;
  }, [flushSave]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      saveRetryAttemptRef.current = 0;
      if (saveRetryTimerRef.current) {
        clearTimeout(saveRetryTimerRef.current);
        saveRetryTimerRef.current = null;
      }
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
      saveRetryAttemptRef.current = 0;
      if (saveRetryTimerRef.current) {
        clearTimeout(saveRetryTimerRef.current);
        saveRetryTimerRef.current = null;
      }
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
        headers: shareToken ? { "x-collabdocs-share": shareToken } : undefined,
        retries: 1,
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
    [documentId, shareToken],
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
      if (saveRetryTimerRef.current) clearTimeout(saveRetryTimerRef.current);
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
    if (document?.access.permission === "view") return;
    const nextTitle = event.target.value;
    setTitle(nextTitle);
    if (nextTitle.trim()) queueSave({ title: nextTitle.trim() });
  }

  function handleFontChange(event: ChangeEvent<HTMLSelectElement>) {
    if (document?.access.permission === "view") return;
    const nextFont = event.target.value as EditorFont;
    setFontFamily(nextFont);
    queueSave({ fontFamily: nextFont });
  }

  function toggleWidePage() {
    if (document?.access.permission === "view") return;
    const nextWide = !isWide;
    setIsWide(nextWide);
    queueSave({ isWide: nextWide });
  }

  async function closeEditor() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (saveRetryTimerRef.current) clearTimeout(saveRetryTimerRef.current);
    await flushSave();
    onClose();
  }

  async function createShareLink() {
    setShareBusy(true);
    setShareCopied(false);
    try {
      const shared = await requestJson<ShareDetails>("/api/shares", {
        method: "POST",
        body: JSON.stringify({
          documentId,
          permission: sharePermission,
        }),
      });
      setShareDetails(shared);
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(
        error instanceof Error ? error.message : "分享链接生成失败",
      );
    } finally {
      setShareBusy(false);
    }
  }

  async function copyShareLink() {
    if (!shareDetails) return;
    const link = `${window.location.origin}/?share=${encodeURIComponent(shareDetails.token)}`;
    try {
      await navigator.clipboard.writeText(link);
      setShareCopied(true);
    } catch {
      setSaveStatus("error");
      setSaveMessage("复制失败，请手动选择分享链接");
    }
  }

  const uploadAsset = useCallback(
    async (file: File): Promise<UploadedAsset> => {
      if (!document || shareToken) {
        throw new Error("当前访问方式不能上传附件。");
      }
      if (file.size > 20 * 1024 * 1024) {
        throw new Error("单个文件不能超过 20 MB。");
      }

      setSaveMessage(`正在上传 ${file.name}…`);
      try {
        const mimeType = fileMimeType(file);
        const authorization = await requestJson<{
          uploadUrl: string;
          mimeType: string;
        }>("/api/assets", {
          method: "POST",
          body: JSON.stringify({
            workspaceId: document.workspace.id,
            documentId: document.id,
            originalName: file.name,
            mimeType,
            size: file.size,
          }),
        });
        const uploaded = await requestJson<UploadedAsset>(
          authorization.uploadUrl,
          {
            method: "PUT",
            body: file,
            headers: { "Content-Type": authorization.mimeType },
            timeoutMs: 120_000,
          },
        );
        setSaveMessage(`${file.name} 已上传`);
        return uploaded;
      } catch (error) {
        setSaveMessage(error instanceof Error ? error.message : "附件上传失败");
        throw error;
      }
    },
    [document, shareToken],
  );

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
        {document.access.permission === "view" ? (
          <span className="readonly-state">
            <Eye size={15} />
            只读
          </span>
        ) : (
          <button
            className={`save-state save-${saveStatus}`}
            onClick={() => void flushSave()}
            title={saveMessage}
            aria-label={saveMessage}
          >
            <SaveIcon status={saveStatus} />
            <span>{saveMessage}</span>
          </button>
        )}
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
                  key={user.connectionId ?? user.id}
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
        {document.access.canShare ? (
          <button
            className="editor-share-button secondary-button"
            onClick={() => {
              setShareDetails(null);
              setShareCopied(false);
              setShareDialogOpen(true);
            }}
            disabled={shareBusy}
          >
            {shareBusy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Share2 size={16} />
            )}
            <span>分享</span>
          </button>
        ) : null}
        <button
          className="icon-button"
          onClick={onToggleTheme}
          aria-label="切换明暗主题"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      {document.access.permission === "edit" &&
      (saveStatus === "error" ||
        saveStatus === "conflict" ||
        realtimeStatus === "unauthorized") ? (
        <section className="editor-sync-alert" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>文档同步遇到问题</strong>
            <span>
              {realtimeStatus === "unauthorized"
                ? "匿名协作凭证已失效，请重新连接后继续编辑。"
                : saveMessage}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (realtimeStatus === "unauthorized") {
                window.location.reload();
              } else {
                void flushSave();
              }
            }}
          >
            <RefreshCw size={15} />
            重新同步
          </button>
        </section>
      ) : null}

      <section className="editor-controls" aria-label="文档设置">
        <label className="font-picker">
          {fontFamily === "handwriting" ? (
            <PenLine size={16} />
          ) : (
            <Type size={16} />
          )}
          <span className="sr-only">文档字体</span>
          <select
            value={fontFamily}
            onChange={handleFontChange}
            disabled={document.access.permission === "view"}
          >
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
          disabled={document.access.permission === "view"}
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
            readOnly={document.access.permission === "view"}
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
            permission={document.access.permission}
            shareToken={shareToken}
            onUploadAsset={!shareToken ? uploadAsset : undefined}
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
            {document.access.permission === "view"
              ? "只读分享 · 内容会随协作者实时更新"
              : online
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
              {inspectedUser.attribution
                ? "这段文字由 TA 写下"
                : "正在这篇文档中"}
            </span>
          </div>
        </div>
      ) : null}

      {shareDialogOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="invite-dialog share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
          >
            <button
              className="dialog-close icon-button"
              onClick={() => setShareDialogOpen(false)}
              aria-label="关闭分享窗口"
            >
              ×
            </button>
            <span className="dialog-mark">
              <Share2 size={22} />
            </span>
            <span className="eyebrow">DOCUMENT SHARE</span>
            <h2 id="share-dialog-title">分享《{document.title}》</h2>
            <p>获得链接的人会生成自己的随机头像和昵称，只能访问这一篇文档。</p>
            <div className="share-permission-switch" aria-label="分享权限">
              <button
                className={sharePermission === "view" ? "is-active" : ""}
                onClick={() => {
                  setSharePermission("view");
                  setShareDetails(null);
                  setShareCopied(false);
                }}
              >
                仅查看
              </button>
              <button
                className={sharePermission === "edit" ? "is-active" : ""}
                onClick={() => {
                  setSharePermission("edit");
                  setShareDetails(null);
                  setShareCopied(false);
                }}
              >
                可编辑
              </button>
            </div>
            {shareDetails ? (
              <>
                <label className="invite-link-field">
                  <span>
                    七天内有效 · 当前为
                    {shareDetails.permission === "edit" ? "可编辑" : "仅查看"}
                  </span>
                  <input
                    readOnly
                    value={`${window.location.origin}/?share=${encodeURIComponent(shareDetails.token)}`}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
                <button
                  className="primary-button invite-copy"
                  onClick={() => void copyShareLink()}
                >
                  {shareCopied ? <Check size={17} /> : <Copy size={17} />}
                  {shareCopied ? "已复制分享链接" : "复制分享链接"}
                </button>
              </>
            ) : (
              <button
                className="primary-button invite-copy"
                onClick={() => void createShareLink()}
                disabled={shareBusy}
              >
                {shareBusy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Share2 size={17} />
                )}
                生成{sharePermission === "edit" ? "可编辑" : "只读"}链接
              </button>
            )}
            <small>分享链接是访问凭证，请只发送给可信的人。</small>
          </section>
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
