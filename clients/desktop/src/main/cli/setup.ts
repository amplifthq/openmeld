import { execFile } from "node:child_process";
import {
  type LocalMachineIssueAgentEvent,
  localMachineIssueAgentEventSchema,
} from "@openmeld/schemas";
import type {
  CliProblem,
  ServiceSetupGuidanceView,
} from "../../shared/view-types";
import type { ExecFileFn } from "./driver";
import { buildDesktopCommandEnv } from "./path-search";
import { resolveOpenMeldBin } from "./resolve-openmeld";

// `openmeld setup` predates the `--json` envelope contract (it emits a multi-step
// agent-view stream ending in `setup.complete`), so it can't be driven by the
// json driver. We run `--view agent` and look for the completion signal.

const SETUP_TIMEOUT_MS = 5 * 60_000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export type SetupResult = {
  completed: boolean;
  problem: CliProblem | null;
  serviceGuidance: ServiceSetupGuidanceView | null;
};

type SetupDeps = {
  openMeldBin?: string | null;
  env?: NodeJS.ProcessEnv;
  exec?: ExecFileFn;
};

export function runSetup(deps: SetupDeps = {}): Promise<SetupResult> {
  const exec = deps.exec ?? (execFile as unknown as ExecFileFn);
  const env = buildDesktopCommandEnv(deps.env);
  const openMeldBin = resolveOpenMeldBin({ env, override: deps.openMeldBin });
  return new Promise((resolve) => {
    exec(
      openMeldBin,
      ["setup", "--view", "agent"],
      { timeout: SETUP_TIMEOUT_MS, env, maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout) => {
        resolve(parseSetup(stdout ?? "", error != null));
      }
    );
  });
}

function parseSetup(stdout: string, failed: boolean): SetupResult {
  let localMachineIssueEvent: LocalMachineIssueAgentEvent | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.code === "setup.complete") {
        return {
          completed: true,
          problem: null,
          serviceGuidance: readServiceGuidance(parsed.payload),
        };
      }
      const localMachineIssueResult =
        localMachineIssueAgentEventSchema.safeParse(parsed);
      if (localMachineIssueResult.success) {
        localMachineIssueEvent = localMachineIssueResult.data;
      }
    } catch {
      // ignore non-JSON lines
    }
  }
  if (localMachineIssueEvent) {
    return {
      completed: false,
      problem: localMachineIssueProblem(localMachineIssueEvent),
      serviceGuidance: null,
    };
  }
  return {
    completed: false,
    problem: failed
      ? setupProblem("Setup couldn't be completed.")
      : setupProblem("Setup didn't finish. The service may still be running."),
    serviceGuidance: null,
  };
}

function localMachineIssueProblem(
  event: LocalMachineIssueAgentEvent
): CliProblem {
  const { localMachineIssue } = event.payload;
  return {
    kind: "cli_error",
    code: localMachineIssue.code,
    message: event.message,
    requestId: event.requestId ?? null,
  };
}

function readServiceGuidance(
  payload: unknown
): ServiceSetupGuidanceView | null {
  if (!isRecord(payload)) {
    return null;
  }
  const guidance = payload.serviceGuidance;
  if (!isRecord(guidance)) {
    return null;
  }
  const autoStartDescription = asString(guidance.autoStartDescription);
  const disableAutoStartCommand = asString(guidance.disableAutoStartCommand);
  const statusDescription = asString(guidance.statusDescription);
  const stopCommand = asString(guidance.stopCommand);
  const stoppedLocalAgentsDescription = asString(
    guidance.stoppedLocalAgentsDescription
  );
  if (
    !(
      autoStartDescription &&
      disableAutoStartCommand &&
      statusDescription &&
      stopCommand &&
      stoppedLocalAgentsDescription
    )
  ) {
    return null;
  }
  return {
    autoStartDescription,
    disableAutoStartCommand,
    statusDescription,
    stopCommand,
    stoppedLocalAgentsDescription,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function setupProblem(message: string): CliProblem {
  return {
    kind: "cli_error",
    code: "desktop.setup_incomplete",
    message,
    requestId: null,
  };
}
