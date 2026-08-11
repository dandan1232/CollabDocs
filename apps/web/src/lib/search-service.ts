import type { PrismaClient } from "@collabdocs/db";

import { GuestServiceError, requireGuestSession } from "./guest-service";

interface FolderSearchRow {
  id: string;
  parentId: string | null;
  name: string;
  updatedAt: Date;
}

interface DocumentSearchRow {
  id: string;
  folderId: string | null;
  title: string;
  updatedAt: Date;
  snippet: string;
  nickname: string;
  avatarSeed: string;
  presenceColor: string;
}

export interface WorkspaceSearchResult {
  query: string;
  searchedAt: Date;
  folders: Array<{
    id: string;
    parentId: string | null;
    name: string;
    updatedAt: Date;
    deletedAt: null;
    purgeAfter: null;
  }>;
  documents: Array<{
    id: string;
    folderId: string | null;
    title: string;
    updatedAt: Date;
    deletedAt: null;
    purgeAfter: null;
    searchSnippet: string;
    updatedBy: {
      nickname: string;
      avatarUrl: string;
      presenceColor: string;
    };
  }>;
}

async function requireWorkspaceAccess(
  database: PrismaClient,
  credential: string | undefined,
  workspaceId: string,
): Promise<void> {
  const session = await requireGuestSession(database, credential);

  if (!session.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new GuestServiceError(
      "WORKSPACE_ACCESS_DENIED",
      "你没有访问这个空间的权限。",
      403,
    );
  }
}

export function compactSearchSnippet(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

export async function searchWorkspace(
  database: PrismaClient,
  credential: string | undefined,
  workspaceId: string,
  rawQuery: string,
): Promise<WorkspaceSearchResult> {
  const query = rawQuery.trim();
  await requireWorkspaceAccess(database, credential, workspaceId);

  if (!query) {
    return { query, searchedAt: new Date(), folders: [], documents: [] };
  }

  const pattern = `%${escapeLikePattern(query)}%`;
  const [folders, documents] = await Promise.all([
    database.$queryRaw<FolderSearchRow[]>`
      SELECT
        f.id,
        f.parent_id AS "parentId",
        f.name,
        f.updated_at AS "updatedAt"
      FROM folders AS f
      WHERE f.workspace_id = ${workspaceId}::uuid
        AND f.deleted_at IS NULL
        AND f.name ILIKE ${pattern} ESCAPE '\'
      ORDER BY similarity(f.name, ${query}) DESC, f.updated_at DESC
      LIMIT 20
    `,
    database.$queryRaw<DocumentSearchRow[]>`
      SELECT
        d.id,
        d.folder_id AS "folderId",
        d.title,
        d.updated_at AS "updatedAt",
        CASE
          WHEN strpos(lower(d.plain_text), lower(${query})) > 0 THEN
            substring(
              d.plain_text
              FROM greatest(1, strpos(lower(d.plain_text), lower(${query})) - 60)
              FOR 180
            )
          ELSE left(d.plain_text, 180)
        END AS snippet,
        guest.nickname,
        guest.avatar_seed AS "avatarSeed",
        guest.presence_color AS "presenceColor"
      FROM documents AS d
      INNER JOIN guest_identities AS guest ON guest.id = d.updated_by_id
      WHERE d.workspace_id = ${workspaceId}::uuid
        AND d.deleted_at IS NULL
        AND (
          d.search_vector @@ websearch_to_tsquery('simple', ${query})
          OR d.title ILIKE ${pattern} ESCAPE '\'
          OR d.plain_text ILIKE ${pattern} ESCAPE '\'
        )
      ORDER BY
        CASE WHEN d.title ILIKE ${pattern} ESCAPE '\' THEN 1 ELSE 0 END DESC,
        ts_rank_cd(d.search_vector, websearch_to_tsquery('simple', ${query})) DESC,
        similarity(d.title, ${query}) DESC,
        d.updated_at DESC
      LIMIT 40
    `,
  ]);

  return {
    query,
    searchedAt: new Date(),
    folders: folders.map((folder) => ({
      ...folder,
      deletedAt: null,
      purgeAfter: null,
    })),
    documents: documents.map((document) => ({
      id: document.id,
      folderId: document.folderId,
      title: document.title,
      updatedAt: document.updatedAt,
      deletedAt: null,
      purgeAfter: null,
      searchSnippet: compactSearchSnippet(document.snippet),
      updatedBy: {
        nickname: document.nickname,
        avatarUrl: `/api/avatars/${encodeURIComponent(document.avatarSeed)}`,
        presenceColor: document.presenceColor,
      },
    })),
  };
}
