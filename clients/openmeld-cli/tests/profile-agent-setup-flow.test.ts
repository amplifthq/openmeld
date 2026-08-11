import { afterEach, describe, expect, it, vi } from "vitest";

const { listAgentTargetStatesMock, promptSearchSelectMock } = vi.hoisted(
  () => ({
    listAgentTargetStatesMock: vi.fn(),
    promptSearchSelectMock: vi.fn(),
  })
);

vi.mock("@clack/prompts", () => ({
  isCancel: vi.fn((value: unknown) => value === "__cancel__"),
  select: vi.fn(),
}));

vi.mock("../src/agents/registry", async () => {
  const actual = await vi.importActual<typeof import("../src/agents/registry")>(
    "../src/agents/registry"
  );
  return {
    ...actual,
    listAgentTargetStates: listAgentTargetStatesMock,
  };
});

vi.mock("../src/ui/search-select", () => ({
  promptSearchMultiselectWorkbench: vi.fn(),
  promptSearchSelect: (...args: Parameters<typeof promptSearchSelectMock>) =>
    promptSearchSelectMock(...args),
}));

import { resolveAgentProfileSetup } from "../src/profile/agent-setup-flow";
import {
  createEnabledPreferredBuiltinTargetState,
  resolvePreferredAgentControllerRef,
  resolvePreferredRunnableControllerId,
} from "./helpers/agent-registry-derived";

describe("agent profile setup searchable controller picker", () => {
  afterEach(() => {
    vi.clearAllMocks();
    listAgentTargetStatesMock.mockReset();
    promptSearchSelectMock.mockReset();
  });

  it("uses searchable single-select for controller candidates", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    const preferredController = createEnabledPreferredBuiltinTargetState();

    listAgentTargetStatesMock.mockResolvedValue([preferredController]);
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: resolvePreferredRunnableControllerId(),
    });
    selectMock.mockResolvedValueOnce("mention_only");

    const result = await resolveAgentProfileSetup({
      interactive: true,
      useAutoSelectionWhenNonInteractive: true,
    });

    expect(result).toMatchObject({
      status: "configured",
      agentControllerRef: resolvePreferredAgentControllerRef(),
      selectionMode: "interactive",
    });

    const pickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
      | {
          message?: string;
          items?: Array<{
            value: string;
            label: string;
            detail?: string;
          }>;
        }
      | undefined;
    expect(pickerCall?.message).toBe(
      "Choose which agent controller this profile should use."
    );
    expect(pickerCall?.items?.[0]).toMatchObject({
      value: resolvePreferredRunnableControllerId(),
      label: preferredController.displayName,
    });
    expect(pickerCall?.items?.[0]?.detail).toContain(
      `ID ${resolvePreferredRunnableControllerId()}`
    );
    expect(pickerCall?.items?.at(-1)).toMatchObject({
      label: "Skip for now",
    });
  });

  it("keeps selectable controller candidates that are not ready yet in the picker", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    const preferredController = {
      ...createEnabledPreferredBuiltinTargetState(),
      launchStatus: "needs_choice" as const,
    };

    listAgentTargetStatesMock.mockResolvedValue([preferredController]);
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: resolvePreferredRunnableControllerId(),
    });
    selectMock.mockResolvedValueOnce("mention_only");

    const result = await resolveAgentProfileSetup({
      interactive: true,
      useAutoSelectionWhenNonInteractive: true,
    });

    expect(result).toMatchObject({
      status: "configured",
      agentControllerRef: resolvePreferredAgentControllerRef(),
    });
    const pickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
      | {
          items?: Array<{
            value: string;
          }>;
        }
      | undefined;
    expect(pickerCall?.items?.map((item) => item.value)).toContain(
      resolvePreferredRunnableControllerId()
    );
  });

  it("returns skipped_by_user when Skip for now is selected", async () => {
    listAgentTargetStatesMock.mockResolvedValue([
      createEnabledPreferredBuiltinTargetState(),
    ]);
    promptSearchSelectMock.mockImplementationOnce((input: unknown) => {
      const items = (input as { items: Array<{ value: string }> }).items;
      const skipItem = items.at(-1);
      return Promise.resolve({
        status: "submitted",
        value: skipItem?.value,
      });
    });

    const result = await resolveAgentProfileSetup({
      interactive: true,
      useAutoSelectionWhenNonInteractive: true,
    });

    expect(result).toEqual({
      status: "skipped_by_user",
    });
  });

  it("returns cancelled when controller picker is cancelled", async () => {
    listAgentTargetStatesMock.mockResolvedValue([
      createEnabledPreferredBuiltinTargetState(),
    ]);
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "cancelled",
    });

    const result = await resolveAgentProfileSetup({
      interactive: true,
      useAutoSelectionWhenNonInteractive: true,
    });

    expect(result).toEqual({
      status: "cancelled",
    });
  });

  it("returns back when the controller picker backs out", async () => {
    listAgentTargetStatesMock.mockResolvedValue([
      createEnabledPreferredBuiltinTargetState(),
    ]);
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "back",
    });

    const result = await resolveAgentProfileSetup({
      interactive: true,
      useAutoSelectionWhenNonInteractive: true,
      allowBackToCaller: true,
    });

    expect(result).toEqual({
      status: "back",
    });
    const pickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
      | {
          allowBack?: boolean;
          backLabel?: string;
        }
      | undefined;
    expect(pickerCall?.allowBack).toBe(true);
    expect(pickerCall?.backLabel).toBe("Back");
  });

  it("returns to controller selection when response policy goes back after an implicit transport choice", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    const preferredController = createEnabledPreferredBuiltinTargetState();

    listAgentTargetStatesMock.mockResolvedValue([preferredController]);
    promptSearchSelectMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: resolvePreferredRunnableControllerId(),
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: resolvePreferredRunnableControllerId(),
      });
    selectMock
      .mockResolvedValueOnce("__agent_profile_setup_back__")
      .mockResolvedValueOnce("mention_only");

    const result = await resolveAgentProfileSetup({
      interactive: true,
      useAutoSelectionWhenNonInteractive: true,
      allowBackToCaller: true,
    });

    expect(result).toMatchObject({
      status: "configured",
      agentControllerRef: resolvePreferredAgentControllerRef(),
    });
    expect(promptSearchSelectMock).toHaveBeenCalledTimes(2);
  });

  it("returns to controller selection when transport mode goes back", async () => {
    const prompts = await import("@clack/prompts");
    const selectMock = vi.mocked(prompts.select);
    const preferredController = {
      ...createEnabledPreferredBuiltinTargetState(),
      transportModes: [
        {
          mode: "local-cli" as const,
          label: "Local CLI (Primary)",
          description: "Primary local transport",
        },
        {
          mode: "local-cli" as const,
          label: "Local CLI (Secondary)",
          description: "Secondary local transport",
        },
      ],
    };

    listAgentTargetStatesMock.mockResolvedValue([preferredController]);
    promptSearchSelectMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: resolvePreferredRunnableControllerId(),
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: resolvePreferredRunnableControllerId(),
      });
    selectMock
      .mockResolvedValueOnce("__agent_profile_setup_back__")
      .mockResolvedValueOnce("local-cli")
      .mockResolvedValueOnce("mention_only");

    const result = await resolveAgentProfileSetup({
      interactive: true,
      useAutoSelectionWhenNonInteractive: true,
    });

    expect(result).toMatchObject({
      status: "configured",
      transportMode: "local-cli",
    });
    expect(promptSearchSelectMock).toHaveBeenCalledTimes(2);
    const transportPromptCalls = selectMock.mock.calls.filter((call) => {
      const [payload] = call;
      return (
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        payload.message ===
          "How should this profile connect to its agent controller?"
      );
    });
    expect(transportPromptCalls).toHaveLength(2);
  });
});
