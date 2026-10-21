import { PassThrough, Writable } from "node:stream";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { runStartDisclaimerStep } from "../src/commands/start-auth-and-readiness";
import {
  getConfiguredOnboardingDisclaimerAcceptedAt,
  getConfiguredStartV1OnboardingState,
  updateConfiguredOnboardingConfig,
} from "../src/config/runtime-config";
import { runOnboardingDisclaimerGate } from "../src/onboarding/disclaimer";
import { withTempHome } from "./helpers/fs";

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  note: vi.fn(),
}));

describe("start disclaimer persistence", () => {
  beforeEach(async () => {
    const prompts = await import("@clack/prompts");

    vi.mocked(prompts.cancel).mockReset();
    vi.mocked(prompts.note).mockReset();
  });

  it("persists disclaimer acceptance after explicit human confirmation", async () => {
    await withTempHome(async () => {
      const input = createTestInputStream();
      const resultPromise = runStartDisclaimerStep({
        runtime: {
          resolvedView: "human",
        } as never,
        presenter: {
          data: vi.fn(),
          line: vi.fn(),
        } as never,
        interactive: true,
        streams: {
          input,
          output: createTestOutputStream(),
        },
      });
      input.write("\r");

      await expect(resultPromise).resolves.toBe(true);
      expect(await getConfiguredOnboardingDisclaimerAcceptedAt()).toEqual(
        expect.any(String)
      );
      expect(readPromptInputState(input)).toEqual({
        dataListenerCount: 0,
        paused: true,
        rawModeCalls: [[true], [false]],
      });
    });
  });

  it("does not persist disclaimer acceptance after explicit human decline", async () => {
    await withTempHome(async () => {
      const input = createTestInputStream();
      const resultPromise = runOnboardingDisclaimerGate({
        runtime: {
          resolvedView: "human",
        } as never,
        presenter: {
          data: vi.fn(),
          line: vi.fn(),
        } as never,
        interactive: true,
        codePrefix: "start.disclaimer",
        streams: {
          input,
          output: createTestOutputStream(),
        },
      });
      input.write("\u001b[B\r");

      await expect(resultPromise).resolves.toBe(false);
      expect(await getConfiguredOnboardingDisclaimerAcceptedAt()).toBeNull();
      expect(readPromptInputState(input)).toEqual({
        dataListenerCount: 0,
        paused: true,
        rawModeCalls: [[true], [false]],
      });
    });
  });

  it("does not persist disclaimer acceptance after cancellation", async () => {
    await withTempHome(async () => {
      const input = createTestInputStream();
      const resultPromise = runOnboardingDisclaimerGate({
        runtime: {
          resolvedView: "human",
        } as never,
        presenter: {
          data: vi.fn(),
          line: vi.fn(),
        } as never,
        interactive: true,
        codePrefix: "start.disclaimer",
        streams: {
          input,
          output: createTestOutputStream(),
        },
      });
      input.write("\u0003");

      await expect(resultPromise).resolves.toBe(false);
      expect(await getConfiguredOnboardingDisclaimerAcceptedAt()).toBeNull();
      expect(readPromptInputState(input)).toEqual({
        dataListenerCount: 0,
        paused: true,
        rawModeCalls: [[true], [false]],
      });
    });
  });

  it("persists disclaimer acceptance for agent-view notices", async () => {
    const presenter = {
      data: vi.fn(),
      line: vi.fn(),
    };

    await withTempHome(async () => {
      const accepted = await runStartDisclaimerStep({
        runtime: {
          resolvedView: "agent",
        } as never,
        presenter: presenter as never,
        interactive: true,
      });

      expect(accepted).toBe(true);
      expect(await getConfiguredOnboardingDisclaimerAcceptedAt()).toEqual(
        expect.any(String)
      );
    });

    expect(presenter.data).toHaveBeenCalledWith({
      code: "start.disclaimer",
      payload: {
        acceptedAt: null,
        text: "OpenMeld local service is experimental and changes rapidly. Breaking changes may occur. You are fully responsible for data security and sensitive information handling. Use OpenMeld only in trusted environments.",
        mode: "agent_notice",
        requiresConfirmation: false,
      },
    });
  });

  it("persists disclaimer acceptance for non-interactive human runs", async () => {
    const presenter = {
      data: vi.fn(),
      line: vi.fn(),
    };

    await withTempHome(async () => {
      const accepted = await runStartDisclaimerStep({
        runtime: {
          resolvedView: "human",
        } as never,
        presenter: presenter as never,
        interactive: false,
      });

      expect(accepted).toBe(true);
      expect(await getConfiguredOnboardingDisclaimerAcceptedAt()).toEqual(
        expect.any(String)
      );
    });

    expect(presenter.line).toHaveBeenCalledWith({
      code: "start.disclaimer.auto_continue",
      text: "Non-interactive session: disclaimer displayed and OpenMeld continues.",
    });
  });

  it("keeps start completion separate from disclaimer acceptance state", async () => {
    await withTempHome(async () => {
      await updateConfiguredOnboardingConfig(() => ({
        disclaimerAcceptedAt: new Date().toISOString(),
        startV1: {
          lastCompletedAt: new Date().toISOString(),
        },
      }));

      expect(await getConfiguredOnboardingDisclaimerAcceptedAt()).toEqual(
        expect.any(String)
      );
      expect(
        (await getConfiguredStartV1OnboardingState())?.lastCompletedAt
      ).toEqual(expect.any(String));
    });
  });
});

type TestInputStream = NodeJS.ReadStream & {
  setRawMode: Mock<(mode: boolean) => TestInputStream>;
};

function createTestInputStream(): TestInputStream {
  const input = new PassThrough() as unknown as TestInputStream;
  input.isTTY = true;
  input.setRawMode = vi.fn<(mode: boolean) => TestInputStream>();
  return input;
}

function readPromptInputState(input: TestInputStream): {
  dataListenerCount: number;
  paused: boolean;
  rawModeCalls: unknown[][];
} {
  return {
    dataListenerCount: input.listenerCount("data"),
    paused: input.isPaused(),
    rawModeCalls: input.setRawMode.mock.calls,
  };
}

function createTestOutputStream(): NodeJS.WriteStream {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as NodeJS.WriteStream;
  output.isTTY = true;
  output.columns = 80;
  return output;
}
