import { quoteWindowsProcessArgument } from "@openmeld/adapter-core/process-launch";
import {
  type WindowsUserTaskAction,
  windowsUserTaskActionSchema,
} from "@openmeld/schemas";

export const WINDOWS_TASK_ARGUMENT = "--openmeld-windows-task";
const DIRECT_TASK_PATTERN =
  /(?:^| )--openmeld-windows-task ([A-Za-z0-9+/=]+)$/u;

export function windowsDirectTaskArguments(
  input: WindowsUserTaskAction
): string {
  const action = windowsUserTaskActionSchema.parse({
    executable: input.executable,
    args: input.args,
    env: input.env,
    logPath: input.logPath,
  });
  if (action.args.includes(WINDOWS_TASK_ARGUMENT)) {
    throw new Error("A Windows task cannot contain another task envelope.");
  }
  const encoded = Buffer.from(JSON.stringify(action)).toString("base64");
  return [
    ...action.args.map(quoteWindowsProcessArgument),
    WINDOWS_TASK_ARGUMENT,
    encoded,
  ].join(" ");
}

// This is the Task Scheduler action itself, not a second configuration file.
// Visible role arguments keep process inventory meaningful. Verify them against
// the envelope so registration inspection and execution cannot disagree.
export function readWindowsDirectTaskAction(
  argumentsText: string
): WindowsUserTaskAction | null {
  const encoded = argumentsText.match(DIRECT_TASK_PATTERN)?.[1];
  if (!encoded) {
    return null;
  }
  const action = windowsUserTaskActionSchema.parse(
    JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))
  );
  if (windowsDirectTaskArguments(action) !== argumentsText) {
    throw new Error("Windows task arguments do not match its launch envelope.");
  }
  return action;
}
