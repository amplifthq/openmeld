import {
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
  ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
} from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOpenMeldProfileCapabilitiesMock, selectMock } = vi.hoisted(() => ({
  getOpenMeldProfileCapabilitiesMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  isCancel: (value: unknown) => value === "__cancel__",
  select: (...args: unknown[]) => selectMock(...args),
  text: vi.fn(),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  createOpenMeldAgentProfile: vi.fn(),
  createOpenMeldHumanProfile: vi.fn(),
  getOpenMeldProfileCapabilities: (...args: unknown[]) =>
    getOpenMeldProfileCapabilitiesMock(...args),
}));

import { resolveCreateProfileKind } from "../src/profile/create-flow";

describe("profile create kind capability", () => {
  beforeEach(() => {
    getOpenMeldProfileCapabilitiesMock.mockReset().mockResolvedValue({
      ok: true,
      additionalHumanProfileCreationEnabled: true,
    });
    selectMock.mockReset();
  });

  it("hides Human creation while keeping Agent creation available", async () => {
    getOpenMeldProfileCapabilitiesMock.mockResolvedValue({
      ok: true,
      additionalHumanProfileCreationEnabled: false,
    });
    selectMock.mockResolvedValue("agent");

    await expect(
      resolveCreateProfileKind({
        explicitKind: undefined,
        allowPrompt: true,
        resolvedView: "human",
      })
    ).resolves.toEqual({
      status: "submitted",
      value: "agent",
    });

    expect(selectMock).toHaveBeenCalledWith({
      message: "Profile kind",
      options: [
        { value: "agent", label: "Agent" },
        { value: "__create_profile_kind_exit__", label: "Exit" },
      ],
    });
  });

  it("keeps Agent creation available when the Human capability cannot be read", async () => {
    const capabilityError = new Error("profile capability unavailable");
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    getOpenMeldProfileCapabilitiesMock.mockRejectedValue(capabilityError);
    selectMock.mockResolvedValue("agent");

    await expect(
      resolveCreateProfileKind({
        explicitKind: undefined,
        allowPrompt: true,
        resolvedView: "human",
      })
    ).resolves.toEqual({
      status: "submitted",
      value: "agent",
    });

    expect(selectMock).toHaveBeenCalledWith({
      message: "Profile kind",
      options: [
        { value: "agent", label: "Agent" },
        { value: "__create_profile_kind_exit__", label: "Exit" },
      ],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "[openmeld.profile_capabilities.read_failed]",
      expect.objectContaining({
        message: "profile capability unavailable",
        name: "Error",
      })
    );
    warnSpy.mockRestore();
  });

  it("keeps Human creation available when the capability is enabled", async () => {
    selectMock.mockResolvedValue("human");

    await expect(
      resolveCreateProfileKind({
        explicitKind: undefined,
        allowPrompt: true,
        resolvedView: "human",
      })
    ).resolves.toEqual({
      status: "submitted",
      value: "human",
    });

    expect(selectMock.mock.calls[0]?.[0]).toMatchObject({
      options: [
        { value: "human", label: "Human" },
        { value: "agent", label: "Agent" },
        { value: "__create_profile_kind_exit__", label: "Exit" },
      ],
    });
  });

  it("rejects explicit Human creation when the capability is disabled", async () => {
    getOpenMeldProfileCapabilitiesMock.mockResolvedValue({
      ok: true,
      additionalHumanProfileCreationEnabled: false,
    });

    await expect(
      resolveCreateProfileKind({
        explicitKind: "human",
        allowPrompt: false,
        resolvedView: "human",
      })
    ).rejects.toMatchObject({
      code: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
      message: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
    });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("fails closed with the stable Human rejection when the capability cannot be read", async () => {
    const capabilityError = new Error("profile capability unavailable");
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    getOpenMeldProfileCapabilitiesMock.mockRejectedValue(capabilityError);

    await expect(
      resolveCreateProfileKind({
        explicitKind: "human",
        allowPrompt: false,
        resolvedView: "human",
      })
    ).rejects.toMatchObject({
      code: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_CODE,
      cause: capabilityError,
      message: ADDITIONAL_HUMAN_PROFILE_CREATION_DISABLED_MESSAGE,
    });
    warnSpy.mockRestore();
  });

  it("does not make Agent creation depend on the Human capability", async () => {
    await expect(
      resolveCreateProfileKind({
        explicitKind: "agent",
        allowPrompt: false,
        resolvedView: "human",
      })
    ).resolves.toEqual({
      status: "submitted",
      value: "agent",
    });
    expect(getOpenMeldProfileCapabilitiesMock).not.toHaveBeenCalled();
  });
});
