import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import { resolveSpaceJoinAccessBootstrap } from "../src/space/join-access-bootstrap";
import { runSpaceJoinConnectHandoff } from "../src/space/join-connect-handoff";

const cancelMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn());
const fetchSpaceMetaMock = vi.hoisted(() => vi.fn());
const passwordPromptMock = vi.hoisted(() => vi.fn());
const runConnectMock = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => ({
  cancel: (...args: unknown[]) => cancelMock(...args),
  confirm: (...args: unknown[]) => confirmMock(...args),
  isCancel: (value: unknown) => isCancelMock(value),
  password: (...args: unknown[]) => passwordPromptMock(...args),
  select: vi.fn(),
}));

vi.mock("../src/space/meta-api", () => ({
  fetchSpaceMeta: (...args: unknown[]) => fetchSpaceMetaMock(...args),
}));

vi.mock("../src/space/connect", () => ({
  runConnect: (...args: Parameters<typeof runConnectMock>) =>
    runConnectMock(...args),
}));

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const HUMAN_PROFILE = {
  openMeldProfileId: "hum-join-password-composition",
  profileName: "Felix",
  profileHandle: "felix",
  profileKind: "human",
  status: "active",
  ownerUserId: "user-1",
  source: "cli_create",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-03-05T00:00:00.000Z",
  updatedAt: "2026-03-05T00:00:00.000Z",
} satisfies OpenMeldProfile;

describe("space join password retry composition", () => {
  beforeEach(() => {
    cancelMock.mockReset();
    confirmMock.mockReset().mockResolvedValue(true);
    isCancelMock.mockReset().mockReturnValue(false);
    fetchSpaceMetaMock.mockReset();
    passwordPromptMock.mockReset();
    runConnectMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("keeps access bootstrap and connect recovery on one shared password retry contract", async () => {
    fetchSpaceMetaMock.mockResolvedValueOnce({
      spaceId: SPACE_ID,
      passwordProtected: true,
    });
    runConnectMock
      .mockRejectedValueOnce(
        new Error(
          'HTTP 403: {"ok":false,"error":{"code":"space.password_invalid","message":"space password invalid"}}'
        )
      )
      .mockResolvedValueOnce(undefined);
    passwordPromptMock.mockResolvedValueOnce("corrected-join-password");

    const presenterLines: Array<{ code: string; text: string }> = [];
    const accessResult = await resolveSpaceJoinAccessBootstrap({
      openMeldProfile: HUMAN_PROFILE,
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
      initialPassword: "initial-join-password",
      resolvedView: "human",
      presenter: {
        line: (payload) => {
          presenterLines.push(payload);
        },
      },
      canPromptJoinPassword: true,
      canConfirmPublicSpaceJoin: true,
    });

    expect(accessResult).toMatchObject({
      status: "ready",
      password: "initial-join-password",
      publicSpace: false,
    });
    expect(accessResult.status).toBe("ready");
    if (accessResult.status !== "ready") {
      throw new Error("expected access bootstrap to be ready");
    }
    expect(fetchSpaceMetaMock).toHaveBeenCalledTimes(1);
    expect(fetchSpaceMetaMock.mock.calls[0]?.[0]).toMatchObject({
      password: "initial-join-password",
    });
    expect(passwordPromptMock).not.toHaveBeenCalled();

    const handoffResult = await runSpaceJoinConnectHandoff({
      openMeldProfileId: HUMAN_PROFILE.openMeldProfileId,
      openMeldProfile: HUMAN_PROFILE,
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
      initialPassword: accessResult.password,
      presenter: {
        data: vi.fn(),
        event: vi.fn(),
        line: (payload) => {
          presenterLines.push(payload);
        },
      },
      resolvedView: "human",
      output: "text",
      localEcho: true,
      canPromptJoinPassword: true,
      rawStream: false,
    });

    expect(handoffResult).toBe("connected");
    expect(runConnectMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        password: "initial-join-password",
      })
    );
    expect(runConnectMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        password: "corrected-join-password",
      })
    );
    expect(passwordPromptMock).toHaveBeenCalledTimes(1);
    expect(presenterLines).toContainEqual(
      expect.objectContaining({
        code: "space.join.password.invalid",
      })
    );
  });
});
