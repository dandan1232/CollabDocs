"use client";

import {
  Archive,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  Home,
  LoaderCircle,
  Menu,
  Moon,
  Plus,
  Search,
  Sparkles,
  Star,
  Sun,
  Users,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

const DocumentStudio = dynamic(
  () => import("./document-studio").then((module) => module.DocumentStudio),
  {
    ssr: false,
    loading: () => (
      <main className="editor-fallback is-loading">
        <LoaderCircle className="spin" size={26} />
        <p>正在准备编辑器…</p>
      </main>
    ),
  },
);

type Workspace = {
  id: string;
  type: "personal" | "team";
  name: string;
  role: string;
};

type Session = {
  guest: {
    id: string;
    nickname: string;
    avatarUrl: string;
    presenceColor: string;
  };
  workspaces: Workspace[];
};

type FolderItem = {
  id: string;
  parentId: string | null;
  name: string;
  deletedAt: string | null;
  purgeAfter: string | null;
};

type DocumentItem = {
  id: string;
  folderId: string | null;
  title: string;
  updatedAt: string;
  deletedAt: string | null;
  purgeAfter: string | null;
  updatedBy: { nickname: string; avatarUrl: string; presenceColor: string };
};

type Tree = {
  folders: FolderItem[];
  documents: DocumentItem[];
  favorites: { folderIds: string[]; documentIds: string[] };
};

type View = "home" | "favorites" | "trash";
type CreateMode = "folder" | "document" | "team" | null;

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
    throw new Error(data.error?.message ?? "请求失败，请稍后重试。 ");
  }

  return data;
}

function relativeDate(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function WorkspaceShell() {
  const [session, setSession] = useState<Session | null>(null);
  const [tree, setTree] = useState<Tree | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [draftName, setDraftName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("正在准备你的工作室…");
  const [dark, setDark] = useState(false);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const savedTheme = localStorage.getItem("collabdocs-theme");
      const nextDark =
        savedTheme === "dark" ||
        (!savedTheme && matchMedia("(prefers-color-scheme: dark)").matches);
      setDark(nextDark);
      document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let active = true;
    requestJson<Session>("/api/session", { method: "POST" })
      .then((nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setWorkspaceId(nextSession.workspaces[0]?.id ?? null);
        setNotice("所有更改已保存");
      })
      .catch((error: unknown) => {
        if (active)
          setNotice(error instanceof Error ? error.message : "连接失败");
      });
    return () => {
      active = false;
    };
  }, []);

  const loadTree = useCallback(async () => {
    if (!workspaceId) return;
    const nextTree = await requestJson<Tree>(
      `/api/workspaces/${workspaceId}/tree${view === "trash" ? "?view=trash" : ""}`,
    );
    setTree(nextTree);
  }, [view, workspaceId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadTree().catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : "目录加载失败"),
      );
    });

    return () => cancelAnimationFrame(frame);
  }, [loadTree]);

  const workspace = session?.workspaces.find((item) => item.id === workspaceId);
  const activeFolder = tree?.folders.find((item) => item.id === folderId);
  const contents = useMemo(() => {
    if (!tree) return { folders: [], documents: [] };
    if (query.trim()) {
      const keyword = query.trim().toLocaleLowerCase();
      return {
        folders: tree.folders.filter((item) =>
          item.name.toLocaleLowerCase().includes(keyword),
        ),
        documents: tree.documents.filter((item) =>
          item.title.toLocaleLowerCase().includes(keyword),
        ),
      };
    }
    if (view === "favorites") {
      return {
        folders: tree.folders.filter((item) =>
          tree.favorites.folderIds.includes(item.id),
        ),
        documents: tree.documents.filter((item) =>
          tree.favorites.documentIds.includes(item.id),
        ),
      };
    }
    return {
      folders: tree.folders.filter((item) => item.parentId === folderId),
      documents: tree.documents.filter((item) => item.folderId === folderId),
    };
  }, [folderId, query, tree, view]);

  const recentDocuments = useMemo(
    () =>
      [...(tree?.documents ?? [])]
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
        )
        .slice(0, 4),
    [tree],
  );

  async function submitCreate() {
    const name = draftName.trim();
    if (!name || !workspaceId || !createMode) return;
    setBusy(true);
    try {
      if (createMode === "folder") {
        await requestJson("/api/folders", {
          method: "POST",
          body: JSON.stringify({ workspaceId, parentId: folderId, name }),
        });
      } else if (createMode === "document") {
        const createdDocument = await requestJson<{ id: string }>(
          "/api/documents",
          {
            method: "POST",
            body: JSON.stringify({ workspaceId, folderId, title: name }),
          },
        );
        setActiveDocumentId(createdDocument.id);
      } else {
        const nextSession = await requestJson<Session>("/api/workspaces", {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        setSession(nextSession);
        setWorkspaceId(nextSession.workspaces.at(-1)?.id ?? workspaceId);
      }
      setDraftName("");
      setCreateMode(null);
      await loadTree();
      setNotice("已保存到云端");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(documentId: string) {
    if (!tree) return;
    const selected = tree.favorites.documentIds.includes(documentId);
    await requestJson("/api/favorites", {
      method: selected ? "DELETE" : "PUT",
      body: JSON.stringify({ documentId }),
    });
    await loadTree();
  }

  async function restore(kind: "folder" | "document", id: string) {
    await requestJson(`/api/${kind}s/${id}/restore`, { method: "POST" });
    await loadTree();
    setNotice("内容已恢复");
  }

  function selectView(nextView: View) {
    setView(nextView);
    setFolderId(null);
    setQuery("");
    setSidebarOpen(false);
  }

  function toggleTheme() {
    const nextDark = !dark;
    setDark(nextDark);
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    localStorage.setItem("collabdocs-theme", nextDark ? "dark" : "light");
  }

  if (activeDocumentId) {
    return (
      <DocumentStudio
        documentId={activeDocumentId}
        dark={dark}
        onToggleTheme={toggleTheme}
        onClose={() => {
          setActiveDocumentId(null);
          void loadTree();
        }}
      />
    );
  }

  return (
    <div className="studio-shell">
      <header className="mobile-header">
        <button
          className="icon-button"
          onClick={() => setSidebarOpen(true)}
          aria-label="打开导航"
        >
          <Menu size={20} />
        </button>
        <Brand />
        <button
          className="icon-button"
          onClick={toggleTheme}
          aria-label="切换主题"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭导航"
        />
      )}
      <aside className={`studio-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar-heading">
          <Brand />
          <button
            className="sidebar-close icon-button"
            onClick={() => setSidebarOpen(false)}
            aria-label="关闭导航"
          >
            <X size={18} />
          </button>
        </div>

        <div className="identity-card">
          {session ? (
            <Image
              src={session.guest.avatarUrl}
              alt=""
              width={40}
              height={40}
              unoptimized
            />
          ) : (
            <span className="avatar-placeholder" />
          )}
          <div>
            <strong>{session?.guest.nickname ?? "正在生成身份"}</strong>
            <span>免登录访客 · 自动保存</span>
          </div>
          <span className="presence-dot" />
        </div>

        <nav className="primary-nav" aria-label="内容导航">
          <NavButton
            active={view === "home"}
            icon={<Home size={18} />}
            label="工作台"
            onClick={() => selectView("home")}
          />
          <NavButton
            active={view === "favorites"}
            icon={<Star size={18} />}
            label="我的收藏"
            onClick={() => selectView("favorites")}
          />
          <NavButton
            active={view === "trash"}
            icon={<Archive size={18} />}
            label="回收站"
            onClick={() => selectView("trash")}
          />
        </nav>

        <div className="sidebar-section-title">
          <span>空间</span>
          <button
            onClick={() => setCreateMode("team")}
            aria-label="新建团队空间"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="workspace-list">
          {session?.workspaces.map((item) => (
            <button
              key={item.id}
              className={item.id === workspaceId ? "is-active" : ""}
              onClick={() => {
                setWorkspaceId(item.id);
                setFolderId(null);
                setView("home");
                setSidebarOpen(false);
              }}
            >
              <span className="workspace-glyph">
                {item.type === "personal" ? "我" : item.name.slice(0, 1)}
              </span>
              <span>{item.name}</span>
              {item.type === "team" && <Users size={14} />}
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <div>
            <span className="sync-indicator" />
            {notice}
          </div>
          <button
            className="icon-button"
            onClick={toggleTheme}
            aria-label="切换明暗主题"
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </aside>

      <main className="studio-main">
        <div className="topbar">
          <div className="breadcrumbs">
            <button
              onClick={() => {
                setFolderId(null);
                setView("home");
              }}
            >
              {workspace?.name ?? "个人空间"}
            </button>
            {activeFolder && (
              <>
                <ChevronRight size={15} />
                <span>{activeFolder.name}</span>
              </>
            )}
          </div>
          <label className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文档与文件夹"
              aria-label="搜索"
            />
          </label>
          <div className="online-stack" title="当前在线">
            <span>1 人在线</span>
            {session && (
              <Image
                src={session.guest.avatarUrl}
                alt={session.guest.nickname}
                width={32}
                height={32}
                unoptimized
              />
            )}
          </div>
        </div>

        <section className="workspace-canvas">
          <div className="canvas-heading">
            <div>
              <span className="eyebrow">
                {view === "trash" ? "30 天内可恢复" : "COLLABORATIVE STUDIO"}
              </span>
              <h1>
                {query
                  ? `搜索“${query}”`
                  : view === "favorites"
                    ? "我的收藏"
                    : view === "trash"
                      ? "回收站"
                      : (activeFolder?.name ?? "今天，一起写点什么")}
              </h1>
              <p>
                {view === "trash"
                  ? "到期内容会自动清理。"
                  : "灵感、资料和正在发生的协作，都在这里。"}
              </p>
            </div>
            {view !== "trash" && (
              <div className="create-actions">
                <button
                  className="secondary-button"
                  onClick={() => setCreateMode("folder")}
                >
                  <FolderPlus size={17} />
                  新建文件夹
                </button>
                <button
                  className="primary-button"
                  onClick={() => setCreateMode("document")}
                >
                  <FilePlus2 size={17} />
                  新建文档
                </button>
              </div>
            )}
          </div>

          {createMode && (
            <form
              className="inline-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCreate();
              }}
            >
              <span>
                {createMode === "folder" ? (
                  <FolderPlus />
                ) : createMode === "document" ? (
                  <FilePlus2 />
                ) : (
                  <Users />
                )}
              </span>
              <label>
                <small>
                  {createMode === "folder"
                    ? "新文件夹"
                    : createMode === "document"
                      ? "新文档"
                      : "新团队空间"}
                </small>
                <input
                  autoFocus
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="输入名称后按 Enter"
                />
              </label>
              <button disabled={busy || !draftName.trim()}>
                {busy ? "保存中" : "创建"}
              </button>
              <button
                type="button"
                className="composer-cancel"
                onClick={() => setCreateMode(null)}
              >
                取消
              </button>
            </form>
          )}

          {!tree ? (
            <LoadingStudio />
          ) : (
            <>
              {view === "home" &&
                !folderId &&
                !query &&
                recentDocuments.length > 0 && (
                  <section className="recent-section">
                    <div className="section-heading">
                      <h2>最近编辑</h2>
                      <span>沿着上次的思路继续</span>
                    </div>
                    <div className="recent-grid">
                      {recentDocuments.map((document, index) => (
                        <DocumentCard
                          key={document.id}
                          document={document}
                          featured={index === 0}
                          favorite={tree.favorites.documentIds.includes(
                            document.id,
                          )}
                          onFavorite={() => void toggleFavorite(document.id)}
                          onOpen={() => setActiveDocumentId(document.id)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              <section className="contents-section">
                <div className="section-heading">
                  <h2>
                    {query
                      ? "搜索结果"
                      : view === "trash"
                        ? "待清理内容"
                        : view === "favorites"
                          ? "收藏内容"
                          : "文件与文档"}
                  </h2>
                  <span>
                    {contents.folders.length + contents.documents.length} 项
                  </span>
                </div>
                {contents.folders.length + contents.documents.length === 0 ? (
                  <EmptyState
                    view={view}
                    onCreate={() => setCreateMode("document")}
                  />
                ) : (
                  <div className="content-list">
                    {contents.folders.map((folder) => (
                      <div className="content-row" key={folder.id}>
                        <button
                          className="content-main"
                          onClick={() =>
                            view === "trash"
                              ? undefined
                              : setFolderId(folder.id)
                          }
                        >
                          <span className="item-icon folder">
                            <FolderOpen size={19} />
                          </span>
                          <span>
                            <strong>{folder.name}</strong>
                            <small>
                              {view === "trash"
                                ? `将在 ${new Date(folder.purgeAfter ?? "").toLocaleDateString("zh-CN")} 清理`
                                : "文件夹"}
                            </small>
                          </span>
                        </button>
                        {view === "trash" && (
                          <button
                            className="text-button"
                            onClick={() => void restore("folder", folder.id)}
                          >
                            恢复
                          </button>
                        )}
                        <ChevronRight className="row-chevron" size={17} />
                      </div>
                    ))}
                    {contents.documents.map((document) => (
                      <div className="content-row" key={document.id}>
                        <button
                          className="content-main"
                          onClick={() => setActiveDocumentId(document.id)}
                        >
                          <span className="item-icon document">
                            <FileText size={19} />
                          </span>
                          <span>
                            <strong>{document.title}</strong>
                            <small>
                              {view === "trash"
                                ? `将在 ${new Date(document.purgeAfter ?? "").toLocaleDateString("zh-CN")} 清理`
                                : `${document.updatedBy.nickname} · ${relativeDate(document.updatedAt)}`}
                            </small>
                          </span>
                        </button>
                        {view === "trash" ? (
                          <button
                            className="text-button"
                            onClick={() =>
                              void restore("document", document.id)
                            }
                          >
                            恢复
                          </button>
                        ) : (
                          <button
                            className={`star-button ${tree.favorites.documentIds.includes(document.id) ? "is-active" : ""}`}
                            onClick={() => void toggleFavorite(document.id)}
                            aria-label="收藏文档"
                          >
                            <Star size={17} fill="currentColor" />
                          </button>
                        )}
                        <ChevronRight className="row-chevron" size={17} />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <i>C</i>
        <b>D</b>
      </span>
      <span>
        <strong>CollabDocs</strong>
        <small>共同创作空间</small>
      </span>
    </div>
  );
}
function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "is-active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
function LoadingStudio() {
  return (
    <div className="loading-studio">
      <span />
      <span />
      <span />
      <p>正在展开你的纸张…</p>
    </div>
  );
}
function EmptyState({ view, onCreate }: { view: View; onCreate: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-sketch">
        {view === "trash" ? (
          <Archive />
        ) : view === "favorites" ? (
          <Star />
        ) : (
          <Sparkles />
        )}
      </div>
      <h3>
        {view === "trash"
          ? "回收站很干净"
          : view === "favorites"
            ? "把重要内容钉在这里"
            : "从第一行开始"}
      </h3>
      <p>
        {view === "trash"
          ? "删除的内容会在这里保留 30 天。"
          : view === "favorites"
            ? "点击文档右侧的星标即可收藏。"
            : "创建文档，邀请伙伴，让想法在同一页发生。"}
      </p>
      {view === "home" && (
        <button className="text-button" onClick={onCreate}>
          新建第一篇文档 <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}
function DocumentCard({
  document,
  featured,
  favorite,
  onFavorite,
  onOpen,
}: {
  document: DocumentItem;
  featured: boolean;
  favorite: boolean;
  onFavorite: () => void;
  onOpen: () => void;
}) {
  return (
    <article className={`document-card ${featured ? "is-featured" : ""}`}>
      <button className="paper-preview" onClick={onOpen}>
        <span className="paper-kicker">COLLAB DOC</span>
        <strong>{document.title}</strong>
        <i />
        <i />
        <i />
      </button>
      <footer>
        <div>
          <Image
            src={document.updatedBy.avatarUrl}
            alt=""
            width={26}
            height={26}
            unoptimized
          />
          <span>
            <strong>{document.title}</strong>
            <small>{relativeDate(document.updatedAt)}</small>
          </span>
        </div>
        <button
          className={favorite ? "is-active" : ""}
          onClick={onFavorite}
          aria-label="收藏"
        >
          <Star size={16} fill="currentColor" />
        </button>
      </footer>
    </article>
  );
}
