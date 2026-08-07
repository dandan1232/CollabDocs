import { DocumentFont } from "@collabdocs/db";

import { errorResponse } from "@/lib/api-response";
import {
  getDocumentForEditing,
  moveDocumentToTrash,
  saveDocumentState,
  updateDocument,
} from "@/lib/content-service";
import { getDatabase } from "@/lib/database";
import { readGuestCredential } from "@/lib/session-cookie";
import { z } from "zod";

const documentIdSchema = z.uuid();
const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    folderId: z.uuid().nullable().optional(),
    position: z.int().min(0).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "至少需要修改一个文档字段。",
  });

const editorStateSchema = z.object({
  title: z.string().trim().min(1).max(240),
  fontFamily: z.enum(["sans", "serif", "handwriting", "mono"]),
  isWide: z.boolean(),
  plainText: z.string().max(2_000_000),
  state: z
    .string()
    .min(1)
    .max(7_000_000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "文档状态不是有效的 Base64 数据。"),
  expectedVersion: z.int().min(0),
});

const documentFonts = {
  sans: DocumentFont.SANS,
  serif: DocumentFont.SERIF,
  handwriting: DocumentFont.HANDWRITING,
  mono: DocumentFont.MONO,
} as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId: rawDocumentId } = await context.params;
    const document = await getDocumentForEditing(
      getDatabase(),
      await readGuestCredential(),
      documentIdSchema.parse(rawDocumentId),
    );

    return Response.json(document);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId: rawDocumentId } = await context.params;
    const input = editorStateSchema.parse(await request.json());
    const document = await saveDocumentState(
      getDatabase(),
      await readGuestCredential(),
      documentIdSchema.parse(rawDocumentId),
      {
        ...input,
        fontFamily: documentFonts[input.fontFamily],
        state: Buffer.from(input.state, "base64"),
      },
    );

    return Response.json({
      ...document,
      fontFamily: document.fontFamily.toLowerCase(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId: rawDocumentId } = await context.params;
    const document = await updateDocument(
      getDatabase(),
      await readGuestCredential(),
      documentIdSchema.parse(rawDocumentId),
      updateDocumentSchema.parse(await request.json()),
    );

    return Response.json(document);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId: rawDocumentId } = await context.params;
    const document = await moveDocumentToTrash(
      getDatabase(),
      await readGuestCredential(),
      documentIdSchema.parse(rawDocumentId),
    );

    return Response.json(document);
  } catch (error) {
    return errorResponse(error);
  }
}
