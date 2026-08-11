import { afterEach, describe, expect, it } from "vitest";
import {
  INTERACTIVE_SPACE_SHELL_ENV_NAME,
  resolveInteractiveHumanShellKind,
} from "../src/space/shell/interactive-shell-kind";

describe("interactive shell kind", () => {
  const originalStdoutTty = process.stdout.isTTY;
  const originalStdinTty = process.stdin.isTTY;
  const originalOverride = process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalStdoutTty,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalStdinTty,
    });
    if (originalOverride === undefined) {
      delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];
    } else {
      process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = originalOverride;
    }
  });

  it("defaults to pi-tui when stdin and stdout are TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];

    expect(resolveInteractiveHumanShellKind()).toBe("pi-tui");
  });

  it("falls back to legacy when either stdio stream is not a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    delete process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME];

    expect(resolveInteractiveHumanShellKind()).toBe("legacy");
  });

  it("honors explicit shell override from env", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = "pi-tui";

    expect(resolveInteractiveHumanShellKind()).toBe("pi-tui");
  });

  it("forces legacy when env override is legacy even on TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    process.env[INTERACTIVE_SPACE_SHELL_ENV_NAME] = "legacy";

    expect(resolveInteractiveHumanShellKind()).toBe("legacy");
  });
});
