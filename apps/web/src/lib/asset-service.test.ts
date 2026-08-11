import { describe, expect, it } from "vitest";

import { GuestServiceError } from "./guest-service";
import { MAX_ASSET_SIZE, validateAssetMetadata } from "./asset-service";

describe("validateAssetMetadata", () => {
  it("normalizes safe upload metadata", () => {
    expect(
      validateAssetMetadata({
        originalName: "../会议 记录.PNG",
        mimeType: "IMAGE/PNG",
        size: 1024,
      }),
    ).toEqual({
      originalName: ".._会议 记录.PNG",
      mimeType: "image/png",
      size: 1024,
    });
  });

  it("rejects oversized files", () => {
    expect(() =>
      validateAssetMetadata({
        originalName: "large.pdf",
        mimeType: "application/pdf",
        size: MAX_ASSET_SIZE + 1,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<GuestServiceError>>({
        code: "ASSET_TOO_LARGE",
        status: 413,
      }),
    );
  });

  it("rejects executable content", () => {
    expect(() =>
      validateAssetMetadata({
        originalName: "setup.exe",
        mimeType: "application/x-msdownload",
        size: 1024,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<GuestServiceError>>({
        code: "ASSET_TYPE_NOT_ALLOWED",
        status: 415,
      }),
    );
  });

  it("normalizes common browser MIME aliases", () => {
    expect(
      validateAssetMetadata({
        originalName: "资料.zip",
        mimeType: "application/x-zip-compressed",
        size: 2048,
      }).mimeType,
    ).toBe("application/zip");
  });
});
