import { describe, expect, it } from "vitest";
import {
  parseSpaceMetaPayload,
  parseSpaceMetaResponse,
} from "../src/space/space-meta-response";

describe("parseSpaceMetaResponse", () => {
  it("accepts storageUsage when the payload matches schema", () => {
    const meta = parseSpaceMetaResponse({
      raw: JSON.stringify({
        spaceId: "space-1",
        organizationId: "org-1",
        visibility: "private",
        name: "ops-room",
        purpose: "coordinate launch reviews",
        storageUsage: {
          usedBytes: 2_101_248,
          softLimitBytes: 9 * 1024 * 1024 * 1024,
          usagePercent: 24,
        },
      }),
      endpoint: "https://example.com/v1/spaces/space-1/meta",
      operation: "fetchSpaceMeta",
    });

    expect(meta.purpose).toBe("coordinate launch reviews");
    expect(meta.storageUsage).toEqual({
      usedBytes: 2_101_248,
      softLimitBytes: 9 * 1024 * 1024 * 1024,
      usagePercent: 24,
    });
  });

  it("throws a clear error when storageUsage shape is invalid", () => {
    expect(() =>
      parseSpaceMetaResponse({
        raw: JSON.stringify({
          spaceId: "space-1",
          organizationId: "org-1",
          visibility: "private",
          storageUsage: {
            usedBytes: "oops",
            softLimitBytes: 9 * 1024 * 1024 * 1024,
            usagePercent: 24,
          },
        }),
        endpoint: "https://example.com/v1/spaces/space-1/meta",
        operation: "fetchSpaceMeta",
      })
    ).toThrow("fetchSpaceMeta received invalid response payload");
  });
});

describe("parseSpaceMetaPayload", () => {
  it("reuses the shared schema for embedded create-space meta payloads", () => {
    const meta = parseSpaceMetaPayload({
      data: {
        spaceId: "space-1",
        organizationId: "org-1",
        visibility: "private",
        name: "ops-room",
        purpose: "coordinate launch reviews",
        storageUsage: {
          usedBytes: 512,
          softLimitBytes: 9 * 1024 * 1024 * 1024,
          usagePercent: 0,
        },
      },
      endpoint: "createSpace",
      operation: "createSpaceMeta",
    });

    expect(meta.purpose).toBe("coordinate launch reviews");
    expect(meta.storageUsage).toEqual({
      usedBytes: 512,
      softLimitBytes: 9 * 1024 * 1024 * 1024,
      usagePercent: 0,
    });
  });
});
