import { runCommandWithEntryChecks } from "../openmeld-cli-entry-checks";
import { getGlobalViewOption } from "../openmeld-cli-view";

export type ProjectOperation =
  | "archive"
  | "bind"
  | "connections.list"
  | "connections.remove"
  | "connections.set-default"
  | "create"
  | "list"
  | "unbind"
  | "update";

export async function runProjectsCliCommand(input: {
  command: ProjectOperation;
  json?: boolean;
  run: (output: { json: boolean; view?: string }) => Promise<void>;
}): Promise<void> {
  const json = input.json === true;
  const view = json ? "agent" : getGlobalViewOption();
  await runCommandWithEntryChecks({
    jsonOutput: json,
    routeTokens: ["projects", ...input.command.split(".")],
    view,
    run: async () => {
      await input.run({ json, view });
    },
  });
}
