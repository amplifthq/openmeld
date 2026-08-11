import { afterEach, describe, expect, it, vi } from "vitest";

const noteMock = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  isCancel: vi.fn(),
  note: (...args: unknown[]) => noteMock(...args),
  outro: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

import { emitStartCompatibilityNotice } from "../src/start-shell/notices";

describe("start compatibility notice", () => {
  afterEach(() => {
    noteMock.mockReset();
  });

  it("keeps --agent-model as a hidden compatibility-only flag in human view", () => {
    emitStartCompatibilityNotice({
      input: {
        agentModel: "gpt-5.3",
      },
      presenter: {
        data: vi.fn(),
      } as never,
      runtime: {
        resolvedView: "human",
      } as never,
    });

    expect(noteMock).toHaveBeenCalledWith(
      "start ignores --agent-model in OpenMeld profile mode",
      "Start Compatibility",
      expect.objectContaining({
        format: expect.any(Function),
      })
    );
  });

  it("emits the same compatibility notice in agent view payloads", () => {
    const dataMock = vi.fn();

    emitStartCompatibilityNotice({
      input: {
        agentModel: "gpt-5.3",
      },
      presenter: {
        data: dataMock,
      } as never,
      runtime: {
        resolvedView: "agent",
      } as never,
    });

    expect(dataMock).toHaveBeenCalledWith({
      code: "start.compatibility.notice",
      payload: {
        message: "start ignores --agent-model in OpenMeld profile mode",
      },
    });
  });
});
