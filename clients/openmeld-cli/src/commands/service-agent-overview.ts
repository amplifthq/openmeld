import { buildAgentOverviewFromContract } from "../command-contracts/helpers";
import { getCommandEntryContract } from "../command-contracts/registry";
import type { CommandEntryName } from "../command-entry-checks/types";
import type { Presenter } from "../runtime/presenter";

export type DaemonAgentOverviewCommand =
  | "menu"
  | "run"
  | "status"
  | "snapshot"
  | "interrupt"
  | "cancel"
  | "install"
  | "reinstall"
  | "uninstall"
  | "stop";

type DaemonAgentOverviewInput = {
  presenter: Presenter;
  command: DaemonAgentOverviewCommand;
};

export function emitDaemonAgentOverview(input: DaemonAgentOverviewInput): void {
  input.presenter.data({
    code: `daemon.${input.command}.agent_overview`,
    payload: buildDaemonAgentOverviewPayload(input.command),
  });
}

function buildDaemonAgentOverviewPayload(
  command: DaemonAgentOverviewCommand
): Record<string, unknown> {
  const entryName = `service.${command}` as CommandEntryName;
  const contract = getCommandEntryContract(entryName);
  if (!contract?.agentOverview) {
    throw new Error(`missing ${entryName} command contract`);
  }
  return buildAgentOverviewFromContract({
    context: {
      includeViewFlag: true,
    },
    overview: contract.agentOverview,
  });
}
