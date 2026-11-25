import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type OpenMeldToolsUpdateStep,
  openMeldToolsUpdateCheckpointSchema,
  resolveOpenMeldToolsUpdateTargetVersions,
} from "@openmeld/schemas";
import type {
  DaemonServiceUpdateJob,
  OpenMeldToolsUpdateOperation,
} from "@openmeld/schemas/types";
import { daemonRuntimeStateRootPath } from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import { assertNoPublishedProductionMutationDuringTests } from "../../config/published-production-safety";

type Owner = "tools" | "service";
function checkpointPath(
  owner: Owner,
  paths: OpenMeldPathResolutionInput
): string {
  return join(
    daemonRuntimeStateRootPath(paths),
    `${owner}-update-checkpoint.json`
  );
}

// Each owner has one replaceable observation. Handoff never modifies either
// owner's pending job, and an old executable need not understand this file.
export async function recordUpdateStep(
  operation:
    | {
        operationId: string;
        requestedAt: string;
        targetVersion?: string;
        targetCliVersion?: string;
        targetServiceVersion?: string;
      }
    | DaemonServiceUpdateJob
    | null,
  step: OpenMeldToolsUpdateStep,
  paths: OpenMeldPathResolutionInput = {}
): Promise<void> {
  if (!operation) {
    return;
  }
  const job = "jobId" in operation;
  try {
    assertNoPublishedProductionMutationDuringTests(paths, "update checkpoint");
    const checkpoint = openMeldToolsUpdateCheckpointSchema.safeParse({
      operationId: job ? operation.jobId : operation.operationId,
      requestedAt: operation.requestedAt,
      step,
      targetCliVersion: operation.targetCliVersion ?? operation.targetVersion,
      targetServiceVersion:
        operation.targetServiceVersion ?? operation.targetVersion,
    });
    if (!checkpoint.success) {
      return;
    }
    const path = checkpointPath(job ? "service" : "tools", paths);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(temporary, JSON.stringify(checkpoint.data), {
        mode: 0o600,
      });
      await rename(temporary, path);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  } catch {
    // A diagnostic write must not interrupt the download or replacement.
    return;
  }
}

export async function readUpdateStep(
  operation: OpenMeldToolsUpdateOperation,
  owner: Owner,
  paths: OpenMeldPathResolutionInput = {}
): Promise<OpenMeldToolsUpdateStep | null> {
  try {
    const raw = await readFile(checkpointPath(owner, paths), "utf8");
    const parsed = openMeldToolsUpdateCheckpointSchema.safeParse(
      JSON.parse(raw)
    );
    const targets = resolveOpenMeldToolsUpdateTargetVersions(operation);
    if (
      parsed.success &&
      parsed.data.operationId === operation.operationId &&
      parsed.data.requestedAt === operation.requestedAt &&
      parsed.data.targetCliVersion === targets.cliVersion &&
      parsed.data.targetServiceVersion === targets.serviceVersion
    ) {
      return parsed.data.step;
    }
  } catch {
    // Mixed-version workers may have only the existing job or attempt.
  }
  return null;
}
