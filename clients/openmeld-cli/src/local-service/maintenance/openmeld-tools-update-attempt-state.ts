import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openMeldToolsUpdateAttemptSchema } from "@openmeld/schemas";
import type { OpenMeldToolsUpdateAttempt } from "@openmeld/schemas/types";
import { daemonRuntimeStateRootPath } from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";

function pendingAttemptPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeStateRootPath(pathInput), "tools-update.json");
}

function lastAttemptPath(pathInput: OpenMeldPathResolutionInput = {}): string {
  return join(daemonRuntimeStateRootPath(pathInput), "tools-update-last.json");
}

export async function readPendingOpenMeldToolsUpdateAttempt(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<OpenMeldToolsUpdateAttempt | null> {
  return await readAttempt(pendingAttemptPath(pathInput));
}

export async function readLastOpenMeldToolsUpdateAttempt(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<OpenMeldToolsUpdateAttempt | null> {
  return await readAttempt(lastAttemptPath(pathInput));
}

export async function persistOpenMeldToolsUpdateAttempt(
  attempt: OpenMeldToolsUpdateAttempt,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await writeAttempt(pendingAttemptPath(pathInput), attempt);
}

export async function completeOpenMeldToolsUpdateAttempt(
  attempt: OpenMeldToolsUpdateAttempt,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await writeAttempt(lastAttemptPath(pathInput), attempt);
  await discardPendingOpenMeldToolsUpdateAttempt(pathInput);
}

export async function discardPendingOpenMeldToolsUpdateAttempt(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await rm(pendingAttemptPath(pathInput), { force: true });
}

async function readAttempt(
  path: string
): Promise<OpenMeldToolsUpdateAttempt | null> {
  const raw = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  );
  if (raw === null) {
    return null;
  }
  const parsed = openMeldToolsUpdateAttemptSchema.safeParse(
    JSON.parse(raw) as unknown
  );
  if (!parsed.success) {
    throw new Error("OpenMeld update state is invalid.");
  }
  return parsed.data;
}

async function writeAttempt(
  path: string,
  attempt: OpenMeldToolsUpdateAttempt
): Promise<void> {
  const validated = openMeldToolsUpdateAttemptSchema.parse(attempt);
  const temporaryPath = `${path}.${String(process.pid)}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}
