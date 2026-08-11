import { buildAgentOverviewFromContract } from "../command-contracts/helpers";
import { getCommandEntryContract } from "../command-contracts/registry";
import type { Presenter } from "../runtime/presenter";
import { outJsonLine } from "../ui/io";

export type TopLevelAgentOverviewCommand =
  | "root"
  | "view"
  | "doctor"
  | "whoami"
  | "upgrade"
  | "repair.local_state"
  | "uninstall"
  | "reset";

export function emitTopLevelAgentOverview(input: {
  presenter: Presenter;
  command: TopLevelAgentOverviewCommand;
}): void {
  input.presenter.data({
    code: `${input.command}.agent_overview`,
    payload: buildTopLevelAgentOverviewPayload(input.command),
  });
}

export function emitTopLevelCliAgentOverview(
  command: TopLevelAgentOverviewCommand
): void {
  outJsonLine({
    type: "result",
    code: `${command}.agent_overview`,
    payload: buildTopLevelAgentOverviewPayload(command),
  });
}

function buildTopLevelAgentOverviewPayload(
  command: TopLevelAgentOverviewCommand
): Record<string, unknown> {
  const contract = getCommandEntryContract(resolveTopLevelEntryName(command));
  if (!contract?.agentOverview) {
    throw new Error(`missing ${command} command contract`);
  }
  return buildAgentOverviewFromContract({
    context: {},
    overview: contract.agentOverview,
  });
}

function resolveTopLevelEntryName(command: TopLevelAgentOverviewCommand) {
  switch (command) {
    case "repair.local_state":
      return "repair.local-state" as const;
    default:
      return command;
  }
}
