import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import { resolveSpaceJoinAccessBootstrap } from "../src/space/join-access-bootstrap";

const cancelMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn());
const fetchSpaceMetaMock = vi.hoisted(() => vi.fn());
const promptSpacePasswordMock = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => {
  return {
    cancel: (...args: unknown[]) => cancelMock(...args),
    confirm: (...args: unknown[]) => confirmMock(...args),
    isCancel: (value: unknown) => isCancelMock(value),
    password: (...args: unknown[]) => promptSpacePasswordMock(...args),
  };
});

vi.mock("../src/space/meta-api", () => {
  return {
    fetchSpaceMeta: (...args: unknown[]) => fetchSpaceMetaMock(...args),
  };
});

const OPENMELD_PROFILE = {
  openMeldProfileId: "hum-join-access",
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

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("space join access bootstrap", () => {
  beforeEach(() => {
    cancelMock.mockReset();
    confirmMock.mockReset().mockResolvedValue(true);
    isCancelMock.mockReset().mockReturnValue(false);
    fetchSpaceMetaMock.mockReset();
    promptSpacePasswordMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("prompts for protected-space password and retries before returning ready", async () => {
    const presenter = { line: vi.fn() };
    fetchSpaceMetaMock
      .mockRejectedValueOnce(
        new Error(
          'HTTP 401: {"ok":false,"error":{"code":"space.password_required","message":"space password required"}}'
        )
      )
      .mockResolvedValueOnce({
        spaceId: SPACE_ID,
        passwordProtected: true,
      });
    promptSpacePasswordMock.mockResolvedValueOnce("join-secret");

    const result = await resolveSpaceJoinAccessBootstrap({
      openMeldProfile: OPENMELD_PROFILE,
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
      resolvedView: "human",
      presenter,
      canPromptJoinPassword: true,
      canConfirmPublicSpaceJoin: true,
    });

    expect(result).toMatchObject({
      status: "ready",
      password: "join-secret",
      publicExposure: null,
      spaceMeta: {
        spaceId: SPACE_ID,
        passwordProtected: true,
      },
    });
    expect(fetchSpaceMetaMock).toHaveBeenCalledTimes(2);
    expect(fetchSpaceMetaMock.mock.calls[1]?.[0]).toMatchObject({
      password: "join-secret",
    });
    expect(promptSpacePasswordMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.password.required",
      })
    );
  });

  it("re-prompts after invalid protected-space password until it succeeds", async () => {
    const presenter = { line: vi.fn() };
    fetchSpaceMetaMock
      .mockRejectedValueOnce(
        new Error(
          'HTTP 401: {"ok":false,"error":{"code":"space.password_required","message":"space password required"}}'
        )
      )
      .mockRejectedValueOnce(
        new Error(
          'HTTP 403: {"ok":false,"error":{"code":"space.password_invalid","message":"space password invalid"}}'
        )
      )
      .mockResolvedValueOnce({
        spaceId: SPACE_ID,
        passwordProtected: true,
      });
    promptSpacePasswordMock
      .mockResolvedValueOnce("wrong-password")
      .mockResolvedValueOnce("correct-password");

    const result = await resolveSpaceJoinAccessBootstrap({
      openMeldProfile: OPENMELD_PROFILE,
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
      resolvedView: "human",
      presenter,
      canPromptJoinPassword: true,
      canConfirmPublicSpaceJoin: true,
    });

    expect(result).toMatchObject({
      status: "ready",
      password: "correct-password",
      publicExposure: null,
    });
    expect(promptSpacePasswordMock).toHaveBeenCalledTimes(2);
    expect(fetchSpaceMetaMock).toHaveBeenCalledTimes(3);
    expect(presenter.line).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ code: "space.join.password.required" })
    );
    expect(presenter.line).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ code: "space.join.password.invalid" })
    );
  });

  it("returns cancelled when password entry is cancelled", async () => {
    fetchSpaceMetaMock.mockRejectedValueOnce(
      new Error(
        'HTTP 401: {"ok":false,"error":{"code":"space.password_required","message":"space password required"}}'
      )
    );
    promptSpacePasswordMock.mockResolvedValueOnce(null);

    const result = await resolveSpaceJoinAccessBootstrap({
      openMeldProfile: OPENMELD_PROFILE,
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
      resolvedView: "human",
      presenter: { line: vi.fn() },
      canPromptJoinPassword: true,
      canConfirmPublicSpaceJoin: true,
    });

    expect(result).toEqual({ status: "cancelled" });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("does not prompt public-space confirmation for protected spaces", async () => {
    fetchSpaceMetaMock.mockResolvedValueOnce({
      spaceId: SPACE_ID,
      passwordProtected: true,
    });

    const result = await resolveSpaceJoinAccessBootstrap({
      openMeldProfile: OPENMELD_PROFILE,
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
      resolvedView: "human",
      presenter: { line: vi.fn() },
      canPromptJoinPassword: true,
      canConfirmPublicSpaceJoin: true,
    });

    expect(result).toMatchObject({
      status: "ready",
      publicExposure: null,
    });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("does not warn that a private members-only Space is public", async () => {
    fetchSpaceMetaMock.mockResolvedValueOnce({
      accessMode: "members_only",
      organizationId: "org-1",
      passwordProtected: false,
      spaceId: SPACE_ID,
      visibility: "private",
    });

    const result = await resolveSpaceJoinAccessBootstrap({
      openMeldProfile: OPENMELD_PROFILE,
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
      resolvedView: "human",
      presenter: { line: vi.fn() },
      canPromptJoinPassword: true,
      canConfirmPublicSpaceJoin: true,
    });

    expect(result).toMatchObject({
      status: "ready",
      publicExposure: null,
    });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("cancels before membership flow when public-space confirmation is declined", async () => {
    confirmMock.mockResolvedValueOnce(false);
    fetchSpaceMetaMock.mockResolvedValueOnce({
      accessMode: "public",
      organizationId: "org-1",
      spaceId: SPACE_ID,
      passwordProtected: false,
      visibility: "public",
    });

    const result = await resolveSpaceJoinAccessBootstrap({
      openMeldProfile: OPENMELD_PROFILE,
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
      resolvedView: "human",
      presenter: { line: vi.fn() },
      canPromptJoinPassword: true,
      canConfirmPublicSpaceJoin: true,
    });

    expect(result).toEqual({ status: "cancelled" });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(promptSpacePasswordMock).not.toHaveBeenCalled();
  });

  it("continues after public-space confirmation is accepted", async () => {
    confirmMock.mockResolvedValueOnce(true);
    fetchSpaceMetaMock.mockResolvedValueOnce({
      accessMode: "public",
      organizationId: "org-1",
      spaceId: SPACE_ID,
      passwordProtected: false,
      visibility: "public",
    });

    const result = await resolveSpaceJoinAccessBootstrap({
      openMeldProfile: OPENMELD_PROFILE,
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
      resolvedView: "human",
      presenter: { line: vi.fn() },
      canPromptJoinPassword: false,
      canConfirmPublicSpaceJoin: true,
    });

    expect(result).toMatchObject({
      status: "ready",
      publicExposure: "anyone_can_join",
      spaceMeta: {
        spaceId: SPACE_ID,
        passwordProtected: false,
      },
    });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(promptSpacePasswordMock).not.toHaveBeenCalled();
  });

  it("warns when anyone with the link can read but joining needs a password", async () => {
    fetchSpaceMetaMock.mockResolvedValueOnce({
      accessMode: "public_view_join_password",
      organizationId: "org-1",
      spaceId: SPACE_ID,
      passwordProtected: true,
      visibility: "private",
    });

    const result = await resolveSpaceJoinAccessBootstrap({
      openMeldProfile: OPENMELD_PROFILE,
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
      initialPassword: "join-secret",
      resolvedView: "human",
      presenter: { line: vi.fn() },
      canPromptJoinPassword: false,
      canConfirmPublicSpaceJoin: true,
    });

    expect(result).toMatchObject({
      status: "ready",
      publicExposure: "anyone_can_view",
    });
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Anyone with this Space link can read what is shared here. A password is required to join."
        ),
      })
    );
  });

  it("fails fast for human noninteractive public-space joins without explicit confirmation capability", async () => {
    fetchSpaceMetaMock.mockResolvedValueOnce({
      accessMode: "public",
      organizationId: "org-1",
      spaceId: SPACE_ID,
      passwordProtected: false,
      visibility: "public",
    });

    await expect(
      resolveSpaceJoinAccessBootstrap({
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space: SPACE_ID,
        resolvedView: "human",
        presenter: { line: vi.fn() },
        canPromptJoinPassword: false,
        canConfirmPublicSpaceJoin: false,
      })
    ).rejects.toThrow(
      "This Space can be read by anyone with the link. Re-run this command in an interactive terminal so you can confirm before joining."
    );

    expect(confirmMock).not.toHaveBeenCalled();
    expect(promptSpacePasswordMock).not.toHaveBeenCalled();
  });

  it("keeps invalid password as structured failure in agent view without prompt fallback", async () => {
    fetchSpaceMetaMock.mockRejectedValueOnce(
      new Error(
        'HTTP 403: {"ok":false,"error":{"code":"space.password_invalid","message":"space password invalid"}}'
      )
    );

    await expect(
      resolveSpaceJoinAccessBootstrap({
        openMeldProfile: {
          ...OPENMELD_PROFILE,
          openMeldProfileId: "agt-join-access",
          profileName: "local-agent",
          profileHandle: "local-agent",
          profileKind: "agent",
        },
        baseUrl: "http://localhost:8080",
        space: SPACE_ID,
        initialPassword: "wrong-password",
        resolvedView: "agent",
        presenter: { line: vi.fn() },
        canPromptJoinPassword: false,
        canConfirmPublicSpaceJoin: false,
      })
    ).rejects.toThrow("space password invalid");

    expect(promptSpacePasswordMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
