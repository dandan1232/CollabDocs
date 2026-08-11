import {
  type Prisma,
  type PrismaClient,
  WorkspaceRole,
  WorkspaceType,
} from "@collabdocs/db";
import { generateGuestProfile } from "@collabdocs/shared";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const PERSONAL_STORAGE_LIMIT = BigInt(100 * 1024 * 1024);
const TEAM_STORAGE_LIMIT = BigInt(1024 * 1024 * 1024);
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_MAX_USES = 20;

const sessionGuestInclude = {
  memberships: {
    include: {
      workspace: true,
    },
    orderBy: {
      joinedAt: "asc",
    },
  },
} satisfies Prisma.GuestIdentityInclude;

type SessionGuest = Prisma.GuestIdentityGetPayload<{
  include: typeof sessionGuestInclude;
}>;

export interface WorkspaceSummary {
  id: string;
  type: "personal" | "team";
  name: string;
  icon: string | null;
  role: "owner" | "admin" | "member";
  storageUsed: string;
  storageLimit: string;
}

export interface GuestSession {
  guest: {
    id: string;
    nickname: string;
    avatarSeed: string;
    avatarUrl: string;
    presenceColor: string;
    locale: string;
    theme: string;
  };
  workspaces: WorkspaceSummary[];
}

export class GuestServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GuestServiceError";
  }
}

function createSecret(prefix: "cdg" | "cdr" | "cdi"): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function roleName(role: WorkspaceRole): WorkspaceSummary["role"] {
  return role.toLowerCase() as WorkspaceSummary["role"];
}

function workspaceTypeName(type: WorkspaceType): WorkspaceSummary["type"] {
  return type.toLowerCase() as WorkspaceSummary["type"];
}

function serializeSession(guest: SessionGuest): GuestSession {
  return {
    guest: {
      id: guest.id,
      nickname: guest.nickname,
      avatarSeed: guest.avatarSeed,
      avatarUrl: `/api/avatars/${encodeURIComponent(guest.avatarSeed)}`,
      presenceColor: guest.presenceColor,
      locale: guest.locale,
      theme: guest.theme,
    },
    workspaces: guest.memberships
      .filter((membership) => !membership.workspace.deletedAt)
      .map((membership) => ({
        id: membership.workspace.id,
        type: workspaceTypeName(membership.workspace.type),
        name: membership.workspace.name,
        icon: membership.workspace.icon,
        role: roleName(membership.role),
        storageUsed: membership.workspace.storageUsed.toString(),
        storageLimit: membership.workspace.storageLimit.toString(),
      })),
  };
}

async function findSessionByCredential(
  database: PrismaClient,
  credential: string,
): Promise<SessionGuest | null> {
  if (!credential.startsWith("cdg_") || credential.length > 80) {
    return null;
  }

  return database.guestIdentity.findUnique({
    where: { credentialHash: hashSecret(credential) },
    include: sessionGuestInclude,
  });
}

async function findSessionByGuestId(
  database: PrismaClient,
  guestId: string,
): Promise<SessionGuest> {
  const guest = await database.guestIdentity.findUnique({
    where: { id: guestId },
    include: sessionGuestInclude,
  });

  if (!guest) {
    throw new GuestServiceError(
      "SESSION_NOT_FOUND",
      "当前访客身份不存在。",
      401,
    );
  }

  return guest;
}

export async function bootstrapGuestSession(
  database: PrismaClient,
  credential?: string,
): Promise<{ session: GuestSession; credential: string; created: boolean }> {
  if (credential) {
    const existingGuest = await findSessionByCredential(database, credential);

    if (existingGuest) {
      await database.guestIdentity.update({
        where: { id: existingGuest.id },
        data: { lastSeenAt: new Date() },
      });

      return {
        session: serializeSession(existingGuest),
        credential,
        created: false,
      };
    }
  }

  const nextCredential = createSecret("cdg");
  const avatarSeed = randomUUID();
  const profile = generateGuestProfile(avatarSeed);
  const guestId = randomUUID();

  await database.$transaction(async (transaction) => {
    await transaction.guestIdentity.create({
      data: {
        id: guestId,
        credentialHash: hashSecret(nextCredential),
        ...profile,
      },
    });

    const personalWorkspace = await transaction.workspace.create({
      data: {
        type: WorkspaceType.PERSONAL,
        name: `${profile.nickname}的个人空间`,
        icon: "leaf",
        ownerGuestId: guestId,
        storageLimit: PERSONAL_STORAGE_LIMIT,
        members: {
          create: {
            guestId,
            role: WorkspaceRole.OWNER,
          },
        },
      },
    });

    await transaction.document.create({
      data: {
        workspaceId: personalWorkspace.id,
        title: "欢迎来到 CollabDocs",
        createdById: guestId,
        updatedById: guestId,
      },
    });
  });

  return {
    session: serializeSession(await findSessionByGuestId(database, guestId)),
    credential: nextCredential,
    created: true,
  };
}

export async function requireGuestSession(
  database: PrismaClient,
  credential?: string,
): Promise<GuestSession> {
  const guest = credential
    ? await findSessionByCredential(database, credential)
    : null;

  if (!guest) {
    throw new GuestServiceError(
      "SESSION_REQUIRED",
      "请先初始化访客身份。",
      401,
    );
  }

  return serializeSession(guest);
}

export async function updateGuestProfile(
  database: PrismaClient,
  credential: string | undefined,
  profile: { nickname?: string; avatarSeed?: string },
): Promise<GuestSession> {
  const session = await requireGuestSession(database, credential);

  await database.guestIdentity.update({
    where: { id: session.guest.id },
    data: profile,
  });

  return serializeSession(
    await findSessionByGuestId(database, session.guest.id),
  );
}

export async function createTeamWorkspace(
  database: PrismaClient,
  credential: string | undefined,
  input: { name: string; icon?: string },
): Promise<GuestSession> {
  const session = await requireGuestSession(database, credential);

  await database.workspace.create({
    data: {
      type: WorkspaceType.TEAM,
      name: input.name,
      icon: input.icon ?? "sprout",
      ownerGuestId: session.guest.id,
      storageLimit: TEAM_STORAGE_LIMIT,
      members: {
        create: {
          guestId: session.guest.id,
          role: WorkspaceRole.OWNER,
        },
      },
    },
  });

  return serializeSession(
    await findSessionByGuestId(database, session.guest.id),
  );
}

export async function issueWorkspaceInvite(
  database: PrismaClient,
  credential: string | undefined,
  workspaceId: string,
): Promise<{
  token: string;
  workspaceName: string;
  expiresAt: string;
  maxUses: number;
}> {
  const session = await requireGuestSession(database, credential);
  const membership = await database.workspaceMember.findUnique({
    where: {
      workspaceId_guestId: {
        workspaceId,
        guestId: session.guest.id,
      },
    },
    include: { workspace: true },
  });

  if (
    !membership ||
    (membership.role !== WorkspaceRole.OWNER &&
      membership.role !== WorkspaceRole.ADMIN)
  ) {
    throw new GuestServiceError(
      "INVITE_PERMISSION_DENIED",
      "只有团队所有者或管理员可以邀请成员。",
      403,
    );
  }

  if (
    membership.workspace.type !== WorkspaceType.TEAM ||
    membership.workspace.deletedAt
  ) {
    throw new GuestServiceError(
      "TEAM_WORKSPACE_REQUIRED",
      "只有有效的团队空间可以生成邀请链接。",
      400,
    );
  }

  const token = createSecret("cdi");
  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS);
  await database.inviteToken.create({
    data: {
      tokenHash: hashSecret(token),
      workspaceId,
      createdById: session.guest.id,
      expiresAt,
      maxUses: INVITE_MAX_USES,
    },
  });

  return {
    token,
    workspaceName: membership.workspace.name,
    expiresAt: expiresAt.toISOString(),
    maxUses: INVITE_MAX_USES,
  };
}

export async function acceptWorkspaceInvite(
  database: PrismaClient,
  credential: string | undefined,
  token: string,
): Promise<{ session: GuestSession; workspaceId: string }> {
  const session = await requireGuestSession(database, credential);
  if (!token.startsWith("cdi_") || token.length > 80) {
    throw new GuestServiceError(
      "INVALID_INVITE",
      "邀请链接无效或已经失效。",
      400,
    );
  }

  const invite = await database.inviteToken.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { workspace: true },
  });
  const expired = invite?.expiresAt && invite.expiresAt <= new Date();
  const exhausted =
    invite?.maxUses !== null &&
    invite?.maxUses !== undefined &&
    invite.useCount >= invite.maxUses;

  if (
    !invite ||
    invite.revokedAt ||
    invite.workspace.deletedAt ||
    invite.workspace.type !== WorkspaceType.TEAM ||
    expired ||
    exhausted
  ) {
    throw new GuestServiceError(
      "INVALID_INVITE",
      "邀请链接无效、已过期或使用次数已达上限。",
      400,
    );
  }

  const existingMembership = await database.workspaceMember.findUnique({
    where: {
      workspaceId_guestId: {
        workspaceId: invite.workspaceId,
        guestId: session.guest.id,
      },
    },
  });

  if (!existingMembership) {
    await database.$transaction([
      database.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          guestId: session.guest.id,
          role: WorkspaceRole.MEMBER,
        },
      }),
      database.inviteToken.update({
        where: { id: invite.id },
        data: { useCount: { increment: 1 } },
      }),
    ]);
  }

  return {
    session: serializeSession(
      await findSessionByGuestId(database, session.guest.id),
    ),
    workspaceId: invite.workspaceId,
  };
}

export async function issueWorkspaceRecoveryKey(
  database: PrismaClient,
  credential: string | undefined,
  workspaceId: string,
): Promise<string> {
  const session = await requireGuestSession(database, credential);
  const membership = await database.workspaceMember.findUnique({
    where: {
      workspaceId_guestId: {
        workspaceId,
        guestId: session.guest.id,
      },
    },
  });

  if (membership?.role !== WorkspaceRole.OWNER) {
    throw new GuestServiceError(
      "OWNER_REQUIRED",
      "只有空间所有者可以生成恢复密钥。",
      403,
    );
  }

  const recoveryKey = createSecret("cdr");

  await database.recoveryKey.create({
    data: {
      tokenHash: hashSecret(recoveryKey),
      workspaceId,
      createdById: session.guest.id,
    },
  });

  return recoveryKey;
}

export async function recoverWorkspace(
  database: PrismaClient,
  guestId: string,
  recoveryKey: string,
): Promise<GuestSession> {
  if (!recoveryKey.startsWith("cdr_") || recoveryKey.length > 80) {
    throw new GuestServiceError(
      "INVALID_RECOVERY_KEY",
      "恢复密钥无效或已被使用。",
      400,
    );
  }

  const recovery = await database.recoveryKey.findUnique({
    where: { tokenHash: hashSecret(recoveryKey) },
    include: { workspace: true },
  });

  if (!recovery || recovery.revokedAt || recovery.workspace.deletedAt) {
    throw new GuestServiceError(
      "INVALID_RECOVERY_KEY",
      "恢复密钥无效或已被使用。",
      400,
    );
  }

  await database.$transaction(async (transaction) => {
    if (recovery.workspace.ownerGuestId !== guestId) {
      await transaction.workspaceMember.updateMany({
        where: {
          workspaceId: recovery.workspaceId,
          guestId: recovery.workspace.ownerGuestId,
          role: WorkspaceRole.OWNER,
        },
        data: { role: WorkspaceRole.ADMIN },
      });
    }

    await transaction.workspace.update({
      where: { id: recovery.workspaceId },
      data: { ownerGuestId: guestId },
    });

    await transaction.workspaceMember.upsert({
      where: {
        workspaceId_guestId: {
          workspaceId: recovery.workspaceId,
          guestId,
        },
      },
      create: {
        workspaceId: recovery.workspaceId,
        guestId,
        role: WorkspaceRole.OWNER,
      },
      update: { role: WorkspaceRole.OWNER },
    });

    await transaction.recoveryKey.update({
      where: { id: recovery.id },
      data: { revokedAt: new Date() },
    });
  });

  return serializeSession(await findSessionByGuestId(database, guestId));
}
