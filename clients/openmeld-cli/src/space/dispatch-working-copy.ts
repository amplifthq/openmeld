import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveDispatchSpaceActionMcpServer } from "@openmeld/adapter-core";
import {
  cliJsonErrorEnvelopeSchema,
  spaceWorkingCopyResultSchema,
} from "@openmeld/schemas";
import { readDispatchSpaceActionContextFromEnv } from "../runtime/dispatch-space-action-context";

const run = promisify(execFile);
export async function runDispatchWorkingCopy(
  action: "status" | "commit" | "reconcile" | "refresh" | "resolve",
  resolution?: { fileId?: string; revision?: number }
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
      ...(action === "resolve"
        ? [
            "--file-id",
            resolution?.fileId ?? "",
            "--revision",
            String(resolution?.revision ?? 0),
          ]
        : []),
      "--",
      context.spaceId,
      context.workingCopyId,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120_000 }
  ).catch((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "stdout" in error &&
      typeof error.stdout === "string"
    ) {
      let value: unknown;
      try {
        value = JSON.parse(error.stdout);
      } catch {
        // Preserve the original process error when no public JSON error exists.
      }
      const parsed = cliJsonErrorEnvelopeSchema.safeParse(value);
      if (parsed.success) {
        throw new Error(JSON.stringify(parsed.data), { cause: error });
      }
    }
    throw error;
  });
  return spaceWorkingCopyResultSchema.parse(JSON.parse(stdout));
}
