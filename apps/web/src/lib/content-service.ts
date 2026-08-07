import { DocumentFont, type PrismaClient } from "@collabdocs/db";
import * as Y from "yjs";

import {
  GuestServiceError,
  requireGuestSession,
  type GuestSession,
} from "./guest-service";
import { requireDocumentAccess } from "./share-service";

const RECYCLE_BIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface FolderMutation {
  name?: string;
  parentId?: string | null;
  position?: number;
}

interface DocumentMutation {
  title?: string;
  folderId?: string | null;
  position?: number;
}

interface EditorDocumentMutation {
  title: string;
  fontFamily: DocumentFont;
  isWide: boolean;
  plainText: string;
  state: Uint8Array<ArrayBuffer>;
  expectedVersion: number;
}

function recycleAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + RECYCLE_BIN_RETENTION_MS);
}

async function requireWorkspaceAccess(
  database: PrismaClient,
  credential: string | undefined,
  workspaceId: string,
): Promise<GuestSession> {
  const session = await requireGuestSession(database, credential);

  if (!session.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new GuestServiceError(
      "WORKSPACE_ACCESS_DENIED",
      "你没有访问这个空间的权限。",
      403,
    );
  }

  return session;
}

async function requireActiveFolder(
  database: PrismaClient,
  workspaceId: string,
  folderId: string,
) {
  const folder = await database.folder.findFirst({
    where: { id: folderId, workspaceId, deletedAt: null },
  });

  if (!folder) {
    throw new GuestServiceError(
      "FOLDER_NOT_FOUND",
      "目标文件夹不存在或已在回收站中。",
      404,
    );
  }

  return folder;
}

async function validateFolderParent(
  database: PrismaClient,
  workspaceId: string,
  parentId: string | null | undefined,
  movingFolderId?: string,
): Promise<void> {
  if (!parentId) {
    return;
  }

  let cursor: string | null = parentId;
  let depth = 0;

  while (cursor) {
    if (cursor === movingFolderId) {
      throw new GuestServiceError(
        "FOLDER_CYCLE",
        "不能把文件夹移动到它自己或它的子文件夹中。",
        409,
      );
    }

    const parent = await requireActiveFolder(database, workspaceId, cursor);
    cursor = parent.parentId;
    depth += 1;

    if (depth > 1000) {
      throw new GuestServiceError(
        "FOLDER_DEPTH_LIMIT",
        "文件夹层级过深，请先整理目录结构。",
        409,
      );
    }
  }
}

async function getFolderSubtreeIds(
  database: PrismaClient,
  folderId: string,
): Promise<string[]> {
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE subtree AS (
      SELECT id
      FROM folders
      WHERE id = ${folderId}::uuid
      UNION ALL
      SELECT child.id
      FROM folders AS child
      INNER JOIN subtree AS parent ON child.parent_id = parent.id
    )
    SELECT id FROM subtree
  `;

  return rows.map((row) => row.id);
}

export async function getWorkspaceTree(
  database: PrismaClient,
  credential: string | undefined,
  workspaceId: string,
  view: "active" | "trash" = "active",
) {
  const session = await requireWorkspaceAccess(
    database,
    credential,
    workspaceId,
  );
  const deletionFilter = view === "active" ? null : { not: null };

  const [folders, documents, favorites] = await Promise.all([
    database.folder.findMany({
      where: { workspaceId, deletedAt: deletionFilter },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: {
        id: true,
        parentId: true,
        name: true,
        position: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        purgeAfter: true,
      },
    }),
    database.document.findMany({
      where: { workspaceId, deletedAt: deletionFilter },
      orderBy: [{ position: "asc" }, { title: "asc" }],
      select: {
        id: true,
        folderId: true,
        title: true,
        position: true,
        fontFamily: true,
        isWide: true,
        contentVersion: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        purgeAfter: true,
        updatedBy: {
          select: {
            id: true,
            nickname: true,
            avatarSeed: true,
            presenceColor: true,
          },
        },
      },
    }),
    database.favorite.findMany({
      where: { guestId: session.guest.id },
      select: { folderId: true, documentId: true },
    }),
  ]);

  return {
    workspace: session.workspaces.find(
      (workspace) => workspace.id === workspaceId,
    )!,
    view,
    folders,
    documents: documents.map((document) => ({
      ...document,
      fontFamily: document.fontFamily.toLowerCase(),
      updatedBy: {
        ...document.updatedBy,
        avatarUrl: `/api/avatars/${encodeURIComponent(document.updatedBy.avatarSeed)}`,
      },
    })),
    favorites: {
      folderIds: favorites.flatMap((favorite) =>
        favorite.folderId ? [favorite.folderId] : [],
      ),
      documentIds: favorites.flatMap((favorite) =>
        favorite.documentId ? [favorite.documentId] : [],
      ),
    },
  };
}

export async function createFolder(
  database: PrismaClient,
  credential: string | undefined,
  input: { workspaceId: string; parentId?: string | null; name: string },
) {
  const session = await requireWorkspaceAccess(
    database,
    credential,
    input.workspaceId,
  );
  await validateFolderParent(database, input.workspaceId, input.parentId);

  const sibling = await database.folder.aggregate({
    where: {
      workspaceId: input.workspaceId,
      parentId: input.parentId ?? null,
      deletedAt: null,
    },
    _max: { position: true },
  });

  return database.folder.create({
    data: {
      workspaceId: input.workspaceId,
      parentId: input.parentId ?? null,
      name: input.name,
      position: (sibling._max.position ?? -1) + 1,
      createdById: session.guest.id,
    },
  });
}

export async function updateFolder(
  database: PrismaClient,
  credential: string | undefined,
  folderId: string,
  mutation: FolderMutation,
) {
  const folder = await database.folder.findUnique({ where: { id: folderId } });

  if (!folder || folder.deletedAt) {
    throw new GuestServiceError(
      "FOLDER_NOT_FOUND",
      "文件夹不存在或已在回收站中。",
      404,
    );
  }

  await requireWorkspaceAccess(database, credential, folder.workspaceId);

  if (mutation.parentId !== undefined) {
    await validateFolderParent(
      database,
      folder.workspaceId,
      mutation.parentId,
      folder.id,
    );
  }

  return database.folder.update({
    where: { id: folder.id },
    data: mutation,
  });
}

export async function moveFolderToTrash(
  database: PrismaClient,
  credential: string | undefined,
  folderId: string,
) {
  const folder = await database.folder.findUnique({ where: { id: folderId } });

  if (!folder || folder.deletedAt) {
    throw new GuestServiceError(
      "FOLDER_NOT_FOUND",
      "文件夹不存在或已在回收站中。",
      404,
    );
  }

  await requireWorkspaceAccess(database, credential, folder.workspaceId);
  const subtreeIds = await getFolderSubtreeIds(database, folder.id);
  const deletedAt = new Date();
  const purgeAfter = recycleAt(deletedAt);

  const [folders, documents] = await database.$transaction([
    database.folder.updateMany({
      where: { id: { in: subtreeIds }, deletedAt: null },
      data: { deletedAt, purgeAfter },
    }),
    database.document.updateMany({
      where: { folderId: { in: subtreeIds }, deletedAt: null },
      data: { deletedAt, purgeAfter },
    }),
  ]);

  return {
    folderCount: folders.count,
    documentCount: documents.count,
    purgeAfter,
  };
}

export async function restoreFolder(
  database: PrismaClient,
  credential: string | undefined,
  folderId: string,
) {
  const folder = await database.folder.findUnique({ where: { id: folderId } });

  if (!folder?.deletedAt) {
    throw new GuestServiceError(
      "FOLDER_NOT_IN_TRASH",
      "回收站中没有这个文件夹。",
      404,
    );
  }

  await requireWorkspaceAccess(database, credential, folder.workspaceId);
  const subtreeIds = await getFolderSubtreeIds(database, folder.id);
  const parent = folder.parentId
    ? await database.folder.findUnique({ where: { id: folder.parentId } })
    : null;

  const [folders, documents] = await database.$transaction([
    database.folder.updateMany({
      where: { id: { in: subtreeIds }, deletedAt: folder.deletedAt },
      data: { deletedAt: null, purgeAfter: null },
    }),
    database.document.updateMany({
      where: {
        folderId: { in: subtreeIds },
        deletedAt: folder.deletedAt,
      },
      data: { deletedAt: null, purgeAfter: null },
    }),
  ]);

  if (parent?.deletedAt) {
    await database.folder.update({
      where: { id: folder.id },
      data: { parentId: null },
    });
  }

  return { folderCount: folders.count, documentCount: documents.count };
}

export async function createDocument(
  database: PrismaClient,
  credential: string | undefined,
  input: { workspaceId: string; folderId?: string | null; title: string },
) {
  const session = await requireWorkspaceAccess(
    database,
    credential,
    input.workspaceId,
  );

  if (input.folderId) {
    await requireActiveFolder(database, input.workspaceId, input.folderId);
  }

  const sibling = await database.document.aggregate({
    where: {
      workspaceId: input.workspaceId,
      folderId: input.folderId ?? null,
      deletedAt: null,
    },
    _max: { position: true },
  });

  return database.document.create({
    data: {
      workspaceId: input.workspaceId,
      folderId: input.folderId ?? null,
      title: input.title,
      position: (sibling._max.position ?? -1) + 1,
      createdById: session.guest.id,
      updatedById: session.guest.id,
    },
  });
}

export async function getDocumentForEditing(
  database: PrismaClient,
  credential: string | undefined,
  documentId: string,
  shareToken?: string,
) {
  const document = await database.document.findUnique({
    where: { id: documentId },
    include: {
      collaborationState: {
        select: { state: true, schemaVersion: true, updatedAt: true },
      },
      folder: { select: { id: true, name: true } },
      workspace: { select: { id: true, name: true, type: true } },
    },
  });

  if (!document || document.deletedAt) {
    throw new GuestServiceError(
      "DOCUMENT_NOT_FOUND",
      "文档不存在或已在回收站中。",
      404,
    );
  }

  const access = await requireDocumentAccess(
    database,
    credential,
    documentId,
    shareToken,
    "view",
  );

  return {
    id: document.id,
    title: document.title,
    fontFamily: document.fontFamily.toLowerCase(),
    isWide: document.isWide,
    plainText: document.plainText,
    contentVersion: document.contentVersion,
    updatedAt: document.updatedAt,
    state: document.collaborationState
      ? Buffer.from(document.collaborationState.state).toString("base64")
      : null,
    schemaVersion: document.collaborationState?.schemaVersion ?? 1,
    folder: document.folder,
    workspace: {
      ...document.workspace,
      type: document.workspace.type.toLowerCase(),
    },
    viewer: access.session.guest,
    access: {
      permission: access.permission,
      canShare: access.canShare,
    },
  };
}

export async function saveDocumentState(
  database: PrismaClient,
  credential: string | undefined,
  documentId: string,
  mutation: EditorDocumentMutation,
  shareToken?: string,
) {
  const document = await database.document.findUnique({
    where: { id: documentId },
    select: { id: true, workspaceId: true, deletedAt: true },
  });

  if (!document || document.deletedAt) {
    throw new GuestServiceError(
      "DOCUMENT_NOT_FOUND",
      "文档不存在或已在回收站中。",
      404,
    );
  }

  const access = await requireDocumentAccess(
    database,
    credential,
    documentId,
    shareToken,
    "edit",
  );

  return database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${document.id}))`;
    await transaction.document.update({
      where: {
        id: document.id,
      },
      data: {
        title: mutation.title,
        fontFamily: mutation.fontFamily,
        isWide: mutation.isWide,
        plainText: mutation.plainText,
        contentVersion: { increment: 1 },
        updatedById: access.session.guest.id,
      },
    });

    const currentState = await transaction.collaborationState.findUnique({
      where: { documentId: document.id },
      select: { state: true },
    });
    const mergedState = Uint8Array.from(
      currentState
        ? Y.mergeUpdates([
            new Uint8Array(currentState.state),
            mutation.state,
          ])
        : mutation.state,
    );

    await transaction.collaborationState.upsert({
      where: { documentId: document.id },
      create: {
        documentId: document.id,
        state: mergedState,
        schemaVersion: 1,
      },
      update: {
        state: mergedState,
        schemaVersion: 1,
      },
    });

    return transaction.document.findUniqueOrThrow({
      where: { id: document.id },
      select: {
        id: true,
        title: true,
        fontFamily: true,
        isWide: true,
        contentVersion: true,
        updatedAt: true,
      },
    });
  });
}

export async function updateDocument(
  database: PrismaClient,
  credential: string | undefined,
  documentId: string,
  mutation: DocumentMutation,
) {
  const document = await database.document.findUnique({
    where: { id: documentId },
  });

  if (!document || document.deletedAt) {
    throw new GuestServiceError(
      "DOCUMENT_NOT_FOUND",
      "文档不存在或已在回收站中。",
      404,
    );
  }

  const session = await requireWorkspaceAccess(
    database,
    credential,
    document.workspaceId,
  );

  if (mutation.folderId) {
    await requireActiveFolder(
      database,
      document.workspaceId,
      mutation.folderId,
    );
  }

  return database.document.update({
    where: { id: document.id },
    data: { ...mutation, updatedById: session.guest.id },
  });
}

export async function moveDocumentToTrash(
  database: PrismaClient,
  credential: string | undefined,
  documentId: string,
) {
  const document = await database.document.findUnique({
    where: { id: documentId },
  });

  if (!document || document.deletedAt) {
    throw new GuestServiceError(
      "DOCUMENT_NOT_FOUND",
      "文档不存在或已在回收站中。",
      404,
    );
  }

  const session = await requireWorkspaceAccess(
    database,
    credential,
    document.workspaceId,
  );
  const deletedAt = new Date();
  const purgeAfter = recycleAt(deletedAt);

  return database.document.update({
    where: { id: document.id },
    data: {
      deletedAt,
      purgeAfter,
      updatedById: session.guest.id,
    },
  });
}

export async function restoreDocument(
  database: PrismaClient,
  credential: string | undefined,
  documentId: string,
) {
  const document = await database.document.findUnique({
    where: { id: documentId },
  });

  if (!document?.deletedAt) {
    throw new GuestServiceError(
      "DOCUMENT_NOT_IN_TRASH",
      "回收站中没有这个文档。",
      404,
    );
  }

  const session = await requireWorkspaceAccess(
    database,
    credential,
    document.workspaceId,
  );
  const folder = document.folderId
    ? await database.folder.findUnique({ where: { id: document.folderId } })
    : null;

  return database.document.update({
    where: { id: document.id },
    data: {
      folderId: folder?.deletedAt ? null : document.folderId,
      deletedAt: null,
      purgeAfter: null,
      updatedById: session.guest.id,
    },
  });
}

export async function addFavorite(
  database: PrismaClient,
  credential: string | undefined,
  target: { documentId?: string; folderId?: string },
) {
  const targetRecord = target.documentId
    ? await database.document.findUnique({ where: { id: target.documentId } })
    : target.folderId
      ? await database.folder.findUnique({ where: { id: target.folderId } })
      : null;

  if (!targetRecord || targetRecord.deletedAt) {
    throw new GuestServiceError(
      "FAVORITE_TARGET_NOT_FOUND",
      "要收藏的内容不存在或已在回收站中。",
      404,
    );
  }

  const session = await requireWorkspaceAccess(
    database,
    credential,
    targetRecord.workspaceId,
  );

  if (target.documentId) {
    return database.favorite.upsert({
      where: {
        guestId_documentId: {
          guestId: session.guest.id,
          documentId: target.documentId,
        },
      },
      create: { guestId: session.guest.id, documentId: target.documentId },
      update: {},
    });
  }

  return database.favorite.upsert({
    where: {
      guestId_folderId: {
        guestId: session.guest.id,
        folderId: target.folderId!,
      },
    },
    create: { guestId: session.guest.id, folderId: target.folderId! },
    update: {},
  });
}

export async function removeFavorite(
  database: PrismaClient,
  credential: string | undefined,
  target: { documentId?: string; folderId?: string },
) {
  const session = await requireGuestSession(database, credential);

  const result = await database.favorite.deleteMany({
    where: {
      guestId: session.guest.id,
      ...(target.documentId ? { documentId: target.documentId } : {}),
      ...(target.folderId ? { folderId: target.folderId } : {}),
    },
  });

  return { removed: result.count > 0 };
}
