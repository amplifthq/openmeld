import type { Command } from "commander";
import { createCommandContractError } from "./helpers";
import type {
  CommandContractRenderContext,
  CommandPatternContract,
} from "./types";

export type DaemonControlTargetCommand = "cancel" | "interrupt";

type DaemonControlTargetRenderContext = CommandContractRenderContext;

const DAEMON_CONTROL_TARGET_REQUIRED_ARGUMENT =
  "exactly one of --dispatch <id> or --task <id>";
const DAEMON_CONTROL_TARGET_OPTIONAL_ARGUMENT = "--reason <text>";
const DAEMON_CONTROL_TARGET_ERROR =
  "exactly one of --dispatch or --task is required";

export function getDaemonControlTargetPatternContract(
  command: DaemonControlTargetCommand
): CommandPatternContract<DaemonControlTargetRenderContext> {
  return {
    buildCommands: (context) =>
      buildDaemonControlTargetExamples({
        command,
        includeViewFlag: context.includeViewFlag,
      }),
    buildHints: () =>
      buildDaemonControlTargetExamples({
        command,
      }),
    buildOptionalArguments: () => [DAEMON_CONTROL_TARGET_OPTIONAL_ARGUMENT],
    buildRequiredArguments: () => [DAEMON_CONTROL_TARGET_REQUIRED_ARGUMENT],
  };
}

export function registerDaemonControlTargetOptions(input: {
  command: Command;
}): Command {
  return input.command
    .option("--dispatch <id>", "Dispatch ID")
    .option("--task <id>", "Task ID (debug fallback)")
    .option("--reason <text>", `Optional ${input.command.name()} reason`);
}

export function buildDaemonControlTargetExamples(input: {
  command: DaemonControlTargetCommand;
  includeViewFlag?: boolean;
}): string[] {
  return [
    buildDaemonControlTargetCommand({
      command: input.command,
      dispatch: "<id>",
      includeViewFlag: input.includeViewFlag,
    }),
    buildDaemonControlTargetCommand({
      command: input.command,
      task: "<id>",
      includeViewFlag: input.includeViewFlag,
    }),
  ];
}

export function getDaemonControlTargetRequiredArguments(): string[] {
  return [DAEMON_CONTROL_TARGET_REQUIRED_ARGUMENT];
}

export function getDaemonControlTargetOptionalArguments(): string[] {
  return [DAEMON_CONTROL_TARGET_OPTIONAL_ARGUMENT];
}

export function validateDaemonControlTargetInput(input: {
  dispatch?: string;
  task?: string;
}): {
  dispatch: string | null;
  task: string | null;
} {
  const dispatch = normalizeOptionalText(input.dispatch);
  const task = normalizeOptionalText(input.task);
  if ((dispatch && task) || !(dispatch || task)) {
    throw createCommandContractError(
      "daemon.control.invalid_target_selector",
      DAEMON_CONTROL_TARGET_ERROR
    );
  }
  return {
    dispatch,
    task,
  };
}

function buildDaemonControlTargetCommand(input: {
  command: DaemonControlTargetCommand;
  dispatch?: string;
  includeViewFlag?: boolean;
  task?: string;
}): string {
  const tokens = ["openmeld", "service", input.command];
  if (input.dispatch) {
    tokens.push("--dispatch", input.dispatch);
  } else if (input.task) {
    tokens.push("--task", input.task);
  } else {
    throw new Error("daemon control target command requires a selector");
  }
  if (input.includeViewFlag) {
    tokens.push("--view", "agent");
  }
  return tokens.join(" ");
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
