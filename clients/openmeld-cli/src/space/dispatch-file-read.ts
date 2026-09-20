import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveDispatchSpaceActionMcpServer } from "@openmeld/adapter-core";
import {
  cliJsonErrorEnvelopeSchema,
  readSpaceFileTextResponseSchema,
  spaceFileEntryIdSchema,
  spaceFileRevisionNumberSchema,
} from "@openmeld/schemas";
import {
  DISPATCH_OWNED_RUNTIME_MODE,
  OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
} from "../runtime/dispatch-runtime-env";
import { readDispatchSpaceActionContextFromEnv } from "../runtime/dispatch-space-action-context";

const execFileAsync = promisify(execFile);

/** Keep file access outside the controller sandbox, under the existing CLI auth contract. */
export async function readDispatchSpaceFile(input: {
  fileId: string;
  revision?: number;
}) {
  if (
    process.env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV] !==
    DISPATCH_OWNED_RUNTIME_MODE
  ) {
    throw new Error(
      "Space file tools require an active OpenMeld dispatch runtime."
    );
  }
  const context = readDispatchSpaceActionContextFromEnv();
  const command = resolveDispatchSpaceActionMcpServer(process.env);
  if (!command) {
    throw new Error("No active OpenMeld dispatch file reader was found.");
  }
  const fileId = spaceFileEntryIdSchema.parse(input.fileId);
  const revision = spaceFileRevisionNumberSchema
    .optional()
    .parse(input.revision);
  // No shell, arbitrary command, profile, Space, URL, or local path is accepted.
  const args = [
    "space",
    "files",
    "read",
    "--profile",
    context.targetProfileId,
    "--json",
    "--view",
    "agent",
    ...(revision === undefined ? [] : ["--revision", String(revision)]),
    "--",
    context.spaceId,
    fileId,
  ];
  const { stdout } = await execFileAsync(command.commandPath, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
  }).catch((error: unknown) => {
    // Machine-readable CLI errors are emitted on stdout, including permission
    // and transient transport failures. Preserve that public error contract.
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
        /* Retain the process error below. */
      }
      const parsed = cliJsonErrorEnvelopeSchema.safeParse(value);
      if (parsed.success) {
        throw new Error(JSON.stringify(parsed.data), { cause: error });
      }
    }
    throw error;
  });
  const result = readSpaceFileTextResponseSchema.parse(JSON.parse(stdout));
  if (
    result.file.spaceId !== context.spaceId ||
    result.file.id !== fileId ||
    (revision !== undefined && result.revision !== revision)
  ) {
    throw new Error(
      "The Space file response does not match the requested file revision."
    );
  }
  return result;
}
