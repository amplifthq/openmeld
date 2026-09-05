import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExpectedRoutesReadSession } from "../src/system/expected-routes-read-session";

const { getExpectedRoutesMock, readDaemonServiceContractMock } = vi.hoisted(
  () => ({
    getExpectedRoutesMock: vi.fn(),
    readDaemonServiceContractMock: vi.fn(),
  })
);

vi.mock("@openmeld/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openmeld/api-client")>()),
  createLocalRuntimeExpectedRoutesApi: () => ({
    getExpectedRoutes: getExpectedRoutesMock,
  }),
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: vi.fn(async () => "https://gateway.openmeld.invalid"),
}));

vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: readDaemonServiceContractMock,
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: vi.fn(() => ({})),
}));

const resolvedResponse = {
  excludedProfiles: [],
  expectedRoutes: [],
  generatedAt: "2026-07-28T00:00:00.000Z",
  runtimeResolution: "resolved" as const,
  openMeldServiceRuntimeId: "runtime-1",
};

describe("expected-routes read session", () => {
  beforeEach(() => {
    getExpectedRoutesMock.mockReset();
    readDaemonServiceContractMock.mockReset().mockResolvedValue({
      deviceId: "device-1",
      lane: "prod",
    });
  });

  it("falls back through v3 and v2 to legacy when an older cloud rejects negotiation", async () => {
    getExpectedRoutesMock
      .mockRejectedValueOnce(
        new OpenMeldApiClientHttpError({
          code: "invalid_payload",
          message: "invalid payload",
          rawBody: "{}",
          status: 400,
          upstreamCode: null,
        })
      )
      .mockRejectedValueOnce(
        new OpenMeldApiClientHttpError({
          code: "invalid_payload",
          message: "invalid payload",
          rawBody: "{}",
          status: 400,
          upstreamCode: null,
        })
      )
      .mockRejectedValueOnce(
        new OpenMeldApiClientHttpError({
          code: "invalid_payload",
          message: "invalid payload",
          rawBody: "{}",
          status: 400,
          upstreamCode: null,
        })
      )
      .mockResolvedValueOnce(resolvedResponse);

    const result = await createExpectedRoutesReadSession().read();

    expect(result).toEqual({
      contractVersion: "legacy",
      response: resolvedResponse,
      status: "resolved",
    });
    expect(getExpectedRoutesMock).toHaveBeenNthCalledWith(1, {
      contractVersion: "v4",
      deviceId: "device-1",
      lane: "prod",
    });
    expect(getExpectedRoutesMock).toHaveBeenNthCalledWith(2, {
      contractVersion: "v3",
      deviceId: "device-1",
      lane: "prod",
    });
    expect(getExpectedRoutesMock).toHaveBeenNthCalledWith(3, {
      contractVersion: "v2",
      deviceId: "device-1",
      lane: "prod",
    });
    expect(getExpectedRoutesMock).toHaveBeenNthCalledWith(4, {
      deviceId: "device-1",
      lane: "prod",
    });
  });

  it("uses v3 when only v4 is unsupported", async () => {
    getExpectedRoutesMock
      .mockRejectedValueOnce(
        new OpenMeldApiClientHttpError({
          code: "invalid_payload",
          message: "invalid payload",
          rawBody: "{}",
          status: 400,
          upstreamCode: null,
        })
      )
      .mockResolvedValueOnce(resolvedResponse);

    await expect(createExpectedRoutesReadSession().read()).resolves.toEqual({
      contractVersion: "v3",
      response: resolvedResponse,
      status: "resolved",
    });
    expect(getExpectedRoutesMock).toHaveBeenNthCalledWith(1, {
      contractVersion: "v4",
      deviceId: "device-1",
      lane: "prod",
    });
    expect(getExpectedRoutesMock).toHaveBeenNthCalledWith(2, {
      contractVersion: "v3",
      deviceId: "device-1",
      lane: "prod",
    });
  });

  it("recognizes the legacy Gateway invalid_payload alias", async () => {
    getExpectedRoutesMock
      .mockRejectedValueOnce(
        new OpenMeldApiClientHttpError({
          code: "gateway.http_error",
          message: "upstream rejected payload",
          rawBody: "{}",
          status: 400,
          upstreamCode: "invalid_payload",
        })
      )
      .mockResolvedValueOnce(resolvedResponse);

    await expect(createExpectedRoutesReadSession().read()).resolves.toEqual({
      contractVersion: "v3",
      response: resolvedResponse,
      status: "resolved",
    });
    expect(getExpectedRoutesMock).toHaveBeenCalledTimes(2);
  });

  it("does not hide a current server failure behind the compatibility fallback", async () => {
    const error = new OpenMeldApiClientHttpError({
      code: "gateway.http_error",
      message: "service unavailable",
      rawBody: "{}",
      status: 503,
      upstreamCode: "profile_facts_unavailable",
    });
    getExpectedRoutesMock.mockRejectedValueOnce(error);

    await expect(createExpectedRoutesReadSession().read()).rejects.toBe(error);
    expect(getExpectedRoutesMock).toHaveBeenCalledTimes(1);
  });

  it("does not downgrade a network failure", async () => {
    const error = new Error("fetch failed");
    getExpectedRoutesMock.mockRejectedValueOnce(error);

    await expect(createExpectedRoutesReadSession().read()).rejects.toBe(error);
    expect(getExpectedRoutesMock).toHaveBeenCalledTimes(1);
  });

  it("preserves an unresolved runtime response without using compatibility fallback", async () => {
    const unresolvedResponse = {
      excludedProfiles: [],
      expectedRoutes: [],
      generatedAt: "2026-07-28T00:00:00.000Z",
      runtimeResolution: "conflict" as const,
      openMeldServiceRuntimeId: null,
    };
    getExpectedRoutesMock.mockResolvedValueOnce(unresolvedResponse);

    await expect(createExpectedRoutesReadSession().read()).resolves.toEqual({
      contractVersion: "v4",
      response: unresolvedResponse,
      status: "resolved",
    });
  });

  it("rejects a malformed v4 success instead of downgrading it", async () => {
    getExpectedRoutesMock.mockResolvedValueOnce({
      ...resolvedResponse,
      expectedRoutes: [
        {
          agentProfileId: "agt-1",
          bindingId: "binding-1",
          bindingState: "enabled_primary",
          configurationRevision: 4,
          executionTarget: {
            agentControllerConversationId: null,
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "runtime-1",
          },
          profileName: "Agent",
          reasonCodes: [],
          routable: true,
        },
      ],
    });

    await expect(createExpectedRoutesReadSession().read()).rejects.toThrow(
      "v4 response omitted current working-folder identity"
    );
    expect(getExpectedRoutesMock).toHaveBeenCalledTimes(1);
  });

  it("rejects when the local Service contract is missing", async () => {
    readDaemonServiceContractMock.mockResolvedValueOnce(null);

    await expect(createExpectedRoutesReadSession().read()).rejects.toThrow(
      "OpenMeld Service contract is unavailable"
    );
    expect(getExpectedRoutesMock).not.toHaveBeenCalled();
  });

  it("preserves a local Service contract read failure", async () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    readDaemonServiceContractMock.mockRejectedValueOnce(error);

    await expect(createExpectedRoutesReadSession().read()).rejects.toBe(error);
    expect(getExpectedRoutesMock).not.toHaveBeenCalled();
  });

  it("uses compatibility fallback only for an explicit missing endpoint", async () => {
    getExpectedRoutesMock.mockRejectedValueOnce(
      new OpenMeldApiClientHttpError({
        code: "gateway.http_error",
        message: "not found",
        rawBody: "{}",
        status: 404,
        upstreamCode: null,
      })
    );

    await expect(createExpectedRoutesReadSession().read()).resolves.toEqual({
      status: "legacy_endpoint_unavailable",
    });
  });
});
