import { runCommandWithEntryChecks } from "../openmeld-cli-entry-checks";
import { getGlobalViewOption } from "../openmeld-cli-view";
import { resolveRoutinesCliOutputMode } from "./registration";
import type { RoutineOperation } from "./types";

export async function runRoutinesCliCommand(input: {
  command: RoutineOperation;
  json?: boolean;
  run: (output: { json: boolean; view?: string }) => Promise<void>;
}): Promise<void> {
  const outputMode = resolveRoutinesCliOutputMode({
    json: input.json,
    view: getGlobalViewOption(),
  });
  await runCommandWithEntryChecks({
    jsonOutput: outputMode.jsonOutput,
    routeTokens: ["routines", input.command],
    view: outputMode.view,
    run: async () => {
      await input.run({ json: outputMode.json, view: outputMode.view });
    },
  });
}
