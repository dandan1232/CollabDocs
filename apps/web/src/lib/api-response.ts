import { ZodError } from "zod";

import { GuestServiceError } from "./guest-service";

export function errorResponse(error: unknown): Response {
  if (error instanceof GuestServiceError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "提交的数据格式不正确。",
          details: error.issues,
        },
      },
      { status: 400 },
    );
  }

  console.error("Unhandled API error", error);

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "服务暂时不可用，请稍后重试。",
      },
    },
    { status: 500 },
  );
}
