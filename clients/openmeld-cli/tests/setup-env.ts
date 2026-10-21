import pc from "picocolors";
import { afterEach, beforeEach, vi } from "vitest";

type ProcessEnvSnapshot = Record<string, string | undefined>;

let processEnvBeforeTest: ProcessEnvSnapshot = {};

beforeEach(() => {
  process.env.FORCE_COLOR = "0";
  process.env.NO_COLOR = "1";
  processEnvBeforeTest = { ...process.env };
  Object.defineProperty(pc, "isColorSupported", {
    value: false,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  // Vitest 4's restoreAllMocks() only restores vi.spyOn spies. Reset every
  // mock too, so implementations and queued once-values never leak between
  // tests.
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  restoreProcessEnv(processEnvBeforeTest);
  process.exitCode = undefined;
});

function restoreProcessEnv(snapshot: ProcessEnvSnapshot): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      Reflect.deleteProperty(process.env, key);
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
      continue;
    }
    process.env[key] = value;
  }
}
