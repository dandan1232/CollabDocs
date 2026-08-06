import "dotenv/config";

import { createHash } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  PrismaClient,
  WorkspaceRole,
  WorkspaceType,
} from "../src/generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed CollabDocs.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function seed() {
  const credentialHash = createHash("sha256")
    .update("collabdocs-local-demo-guest")
    .digest("hex");

  const guest = await prisma.guestIdentity.upsert({
    where: { credentialHash },
    update: {},
    create: {
      credentialHash,
      nickname: "安静的水獭",
      avatarSeed: "collabdocs-local-demo-guest",
      presenceColor: "#C96F48",
    },
  });

  const existingWorkspace = await prisma.workspace.findFirst({
    where: {
      ownerGuestId: guest.id,
      type: WorkspaceType.PERSONAL,
    },
  });

  if (!existingWorkspace) {
    await prisma.workspace.create({
      data: {
        type: WorkspaceType.PERSONAL,
        name: "安静的水獭的个人空间",
        ownerGuestId: guest.id,
        members: {
          create: {
            guestId: guest.id,
            role: WorkspaceRole.OWNER,
          },
        },
      },
    });
  }
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
