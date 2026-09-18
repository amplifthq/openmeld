import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveDispatchSpaceActionMcpServer } from "@openmeld/adapter-core";
import { spaceWorkingCopyResultSchema } from "@openmeld/schemas";
import { readDispatchSpaceActionContextFromEnv } from "../runtime/dispatch-space-action-context";

const run = promisify(execFile);
export async function runDispatchWorkingCopy(
  action: "status" | "commit" | "reconcile"
) {
  const context = readDispatchSpaceActionContextFromEnv();
  const command = resolveDispatchSpaceActionMcpServer(process.env);
  if (!(command && context.workingCopyId)) {
    throw new Error("This Wake has no prepared working copy.");
  }
  const { stdout } = await run(
    command.commandPath,
    [
      "space",
      "files",
      "working-copy",
      action,
      "--profile",
      context.targetProfileId,
      "--json",
      "--view",
      "agent",
      "--",
      context.spaceId,
      context.workingCopyId,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120_000 }
  );
  return spaceWorkingCopyResultSchema.parse(JSON.parse(stdout));
}
