export type CodexAppServerControlOperation =
  | "command/exec"
  | "config/read"
  | "configRequirements/read"
  | "mcpServerStatus/list"
  | "collaborationMode/list"
  | "thread/fork"
  | "thread/name/set"
  | "thread/read"
  | "thread/resume"
  | "thread/start"
  | "turn/start"
  | "turn/settings/update"
  | "turn/steer";

const FAST_METADATA_ADMISSION_TIMEOUT_MS = 15_000;
// Cold Codex controller admission has reached roughly one minute in production
// baselines. Keep real thread/turn admission bounded while leaving enough room
// for temporary host, plugin, skill, and MCP startup pressure to clear.
const COLD_CONTROLLER_ADMISSION_TIMEOUT_MS = 90_000;

const CONTROL_REQUEST_TIMEOUT_MS_BY_OPERATION: Record<
  CodexAppServerControlOperation,
  number
> = {
  "command/exec": FAST_METADATA_ADMISSION_TIMEOUT_MS,
  "config/read": FAST_METADATA_ADMISSION_TIMEOUT_MS,
  "configRequirements/read": FAST_METADATA_ADMISSION_TIMEOUT_MS,
  "mcpServerStatus/list": FAST_METADATA_ADMISSION_TIMEOUT_MS,
  "collaborationMode/list": FAST_METADATA_ADMISSION_TIMEOUT_MS,
  "thread/fork": COLD_CONTROLLER_ADMISSION_TIMEOUT_MS,
  "thread/name/set": FAST_METADATA_ADMISSION_TIMEOUT_MS,
  // Reading history is a storage read: it does not initialize tools or MCP.
  "thread/read": FAST_METADATA_ADMISSION_TIMEOUT_MS,
  // Resume loads the thread and initializes its tools/MCP just like start.
  "thread/resume": COLD_CONTROLLER_ADMISSION_TIMEOUT_MS,
  "thread/start": COLD_CONTROLLER_ADMISSION_TIMEOUT_MS,
  "turn/start": COLD_CONTROLLER_ADMISSION_TIMEOUT_MS,
  "turn/settings/update": FAST_METADATA_ADMISSION_TIMEOUT_MS,
  "turn/steer": FAST_METADATA_ADMISSION_TIMEOUT_MS,
};

export function resolveCodexAppServerControlRequestTimeoutMs(input: {
  operation: CodexAppServerControlOperation;
  overrideMs?: number;
}): number {
  return (
    input.overrideMs ?? CONTROL_REQUEST_TIMEOUT_MS_BY_OPERATION[input.operation]
  );
}
