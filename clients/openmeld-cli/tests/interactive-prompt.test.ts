import { PassThrough, Writable } from "node:stream";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  readSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readSync: fsMocks.readSync,
  };
});

vi.mock("../src/runtime/distribution", () => ({
  isBinaryDistribution: () => true,
}));

import {
  parseInteractivePromptInputData,
  resolveSynchronousTerminalInputFd,
  runInteractivePrompt,
} from "../src/ui/interactive-prompt";

type TestInputStream = NodeJS.ReadStream & {
  fd?: number;
  setRawMode: Mock<(mode: boolean) => TestInputStream>;
};

describe("interactive prompt input", () => {
  beforeEach(() => {
    fsMocks.readSync.mockReset();
  });

  it("parses raw terminal data without readline keypress events", () => {
    expect(
      parseInteractivePromptInputData("\u001b[B \r\u0015\u0003")
    ).toMatchObject([
      {
        str: undefined,
        key: { name: "down", sequence: "\u001b[B" },
      },
      {
        str: " ",
        key: { name: "space", sequence: " " },
      },
      {
        str: "\r",
        key: { name: "return", sequence: "\r" },
      },
      {
        str: "\u0015",
        key: { ctrl: true, name: "u", sequence: "\u0015" },
      },
      {
        str: "\u0003",
        key: { ctrl: true, name: "c", sequence: "\u0003" },
      },
    ]);
  });

  it("drives prompts from raw TTY data events", async () => {
    const input = createTestInputStream();
    const output = createTestOutputStream();

    const resultPromise = runInteractivePrompt(
      {
        initialState: 0,
        fallbackResult: -1,
        renderLines: (state) => [`Selected index ${String(state)}`],
        handleKeypress: ({ state, key }) => {
          if (key.name === "down") {
            return { type: "state", state: state + 1 };
          }
          if (key.name === "return") {
            return {
              type: "result",
              result: state,
              status: "submitted",
              state,
            };
          }
          return { type: "ignore" };
        },
      },
      { input, output }
    );

    input.write("\u001b[B");
    input.write("\r");

    await expect(resultPromise).resolves.toBe(1);
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(input.isPaused()).toBe(true);
    expect(output.readText()).toContain("Selected index 1");
  });

  it("uses synchronous fd reads for binary terminal input when an fd is available", () => {
    expect(
      resolveSynchronousTerminalInputFd({
        fd: 7,
      } as unknown as NodeJS.ReadStream)
    ).toBe(7);
    expect(
      resolveSynchronousTerminalInputFd({} as unknown as NodeJS.ReadStream)
    ).toBeNull();
  });

  it("does not resume the input stream when binary prompts read synchronously from an fd", async () => {
    const input = createTestInputStream();
    const output = createTestOutputStream();
    input.fd = 7;
    input.resume = vi.fn(() => {
      throw new Error("resume should not be called for synchronous fd reads");
    });
    input.pause = vi.fn(() => {
      throw new Error("pause should not be called for synchronous fd reads");
    });
    fsMocks.readSync.mockImplementation(
      (_fd: number, buffer: NodeJS.ArrayBufferView, offset: number): number => {
        Buffer.from("\r").copy(buffer as Buffer, offset);
        return 1;
      }
    );

    const resultPromise = runInteractivePrompt(
      {
        initialState: "initial",
        fallbackResult: "fallback",
        renderLines: (state) => [`Selected ${state}`],
        handleKeypress: ({ state, key }) => {
          if (key.name === "return") {
            return {
              type: "result",
              result: state,
              status: "submitted",
              state,
            };
          }
          return { type: "ignore" };
        },
      },
      { input, output }
    );

    await expect(resultPromise).resolves.toBe("initial");
    expect(input.resume).not.toHaveBeenCalled();
    expect(input.pause).not.toHaveBeenCalled();
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(fsMocks.readSync).toHaveBeenCalledWith(
      7,
      expect.any(Buffer),
      0,
      64,
      null
    );
  });
});

function createTestInputStream(): TestInputStream {
  const input = new PassThrough() as unknown as TestInputStream;
  input.isTTY = true;
  input.setRawMode = vi.fn<(mode: boolean) => TestInputStream>();
  return input;
}

function createTestOutputStream(): NodeJS.WriteStream & {
  readText: () => string;
} {
  let text = "";
  const output = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    },
  }) as NodeJS.WriteStream & { readText: () => string };
  output.isTTY = true;
  output.columns = 80;
  output.readText = () => text;
  return output;
}
