import { join } from "node:path";
import { windowsUserTaskActionSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { buildDaemonSystemServiceCommandSpec } from "../src/local-service/lifecycle/daemon-service-command-spec";
import {
  readWindowsTaskAction,
  windowsTaskActionArguments,
} from "../src/local-service/lifecycle/windows-user-task";
import { withTempHome } from "./helpers/fs";
import {
  readTaskActionPayload,
  withStoredTaskActionPayload,
} from "./helpers/windows-task-action-fixture";

const ACTION = {
  executable: "C:\\Program Files\\nodejs\\node.exe",
  args: ["C:\\Users\\Fixture\\daemon-service-launcher.mjs", "service", "run"],
  env: {
    OPENMELD_HOME: "C:\\Users\\Fixture\\.openmeld",
    FIXTURE: "中文 & spaces",
  },
  logPath: "C:\\Users\\Fixture\\.openmeld\\runtime\\daemon\\logs\\service.log",
};

describe("Windows task action writer/reader boundary", () => {
  it("round-trips the real Service specification without serializing registration metadata", async () => {
    await withTempHome((home) => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      const spec = buildDaemonSystemServiceCommandSpec({
        controller: "windows-service",
        distribution: "npm",
      });
      expect(spec.workingDirectory).toBeTruthy();
      const logPath = join(home, "service.log");
      const argumentsText = windowsTaskActionArguments({ ...spec, logPath });
      const expected = {
        executable: spec.executable,
        args: spec.args,
        env: spec.env,
        logPath,
      };
      // The strict canonical parser must accept the actual serialized bytes,
      // independently of the compatibility reader for previously stored tasks.
      expect(
        windowsUserTaskActionSchema.parse(readTaskActionPayload(argumentsText))
      ).toEqual(expected);
      expect(readWindowsTaskAction(argumentsText)).toEqual(expected);
      return Promise.resolve();
    });
  });

  it.each([
    { workingDirectory: "C:\\Users\\Fixture\\.openmeld\\runtime\\daemon" },
    {
      workingDirectory: "C:\\Users\\Fixture\\.openmeld\\runtime\\daemon",
      pendingJobPath:
        "C:\\Users\\Fixture\\.openmeld\\runtime\\daemon\\state\\service-update.json",
    },
  ])("reads existing installed task metadata without turning it into execution configuration: %j", (metadata) => {
    const stored = withStoredTaskActionPayload(
      windowsTaskActionArguments(ACTION),
      { ...ACTION, ...metadata }
    );
    expect(readWindowsTaskAction(stored)).toEqual(ACTION);
    expect(windowsTaskActionArguments(readWindowsTaskAction(stored))).toBe(
      windowsTaskActionArguments(ACTION)
    );
  });

  it.each([
    { elevated: true },
    { workingDirectory: 42 },
    { pendingJobPath: null },
    { executable: "" },
    { args: "--unsafe" },
    { env: { TOKEN: 123 } },
    { logPath: null },
  ])("still rejects malformed or unrecognized stored fields: %j", (invalid) => {
    const stored = withStoredTaskActionPayload(
      windowsTaskActionArguments(ACTION),
      { ...ACTION, ...invalid }
    );
    expect(() => readWindowsTaskAction(stored)).toThrow(
      "Windows task contains an invalid OpenMeld launch command."
    );
  });
});
