import { describe, expect, it } from "vitest";
import {
  readWindowsDirectTaskAction,
  windowsDirectTaskArguments,
} from "../src/local-service/lifecycle/windows-task-command";
import { readWindowsTaskAction } from "../src/local-service/lifecycle/windows-user-task";

const action = {
  executable:
    "C:\\Users\\Fixture\\.openmeld\\runtime\\daemon\\bundles\\version\\openmeld.exe",
  args: ["service", "run", "", "中文 with spaces", 'literal"quote', "tail\\"],
  env: { OPENMELD_HOME: "C:\\Users\\Fixture\\.openmeld" },
  logPath: "C:\\Users\\Fixture\\.openmeld\\runtime\\daemon\\logs\\service.log",
};

describe("direct Windows task command", () => {
  it("preserves the command while keeping execution role arguments visible to inventory", () => {
    const text = windowsDirectTaskArguments(action);
    expect(text.startsWith('"service" "run" ')).toBe(true);
    expect(readWindowsDirectTaskAction(text)).toEqual(action);
    expect(readWindowsTaskAction(text)).toEqual(action);
  });
  it("rejects disagreement between executed and inspected arguments", () => {
    const text = windowsDirectTaskArguments(action).replace(
      '"service" "run"',
      '"service" "stop"'
    );
    expect(() => readWindowsDirectTaskAction(text)).toThrow("do not match");
  });
  it("rejects recursive envelopes and leaves historical commands to the migration reader", () => {
    expect(() =>
      windowsDirectTaskArguments({
        ...action,
        args: ["--openmeld-windows-task"],
      })
    ).toThrow("another task envelope");
    expect(readWindowsDirectTaskAction("-EncodedCommand legacy")).toBeNull();
  });
});
