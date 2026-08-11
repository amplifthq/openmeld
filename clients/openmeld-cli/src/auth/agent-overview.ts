import { buildAgentOverviewFromContract } from "../command-contracts/helpers";
import { getCommandEntryContract } from "../command-contracts/registry";
import type { CommandEntryName } from "../command-entry-checks/types";
import type { Presenter } from "../runtime/presenter";

export type AuthAgentOverviewCommand = "menu" | "status" | "login" | "logout";

export function emitAuthAgentOverview(input: {
  presenter: Presenter;
  command: AuthAgentOverviewCommand;
}): void {
  input.presenter.data({
    code: `auth.${input.command}.agent_overview`,
    payload: buildAuthAgentOverviewPayload(input.command),
  });
}

function buildAuthAgentOverviewPayload(
  command: AuthAgentOverviewCommand
): Record<string, unknown> {
  const entryName = `auth.${command}` as CommandEntryName;
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
