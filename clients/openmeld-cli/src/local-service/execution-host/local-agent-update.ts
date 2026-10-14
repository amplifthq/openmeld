import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readClaudeNativeVersion,
  resolveClaudeNativeUpdateCommand,
  updateClaudeNativeInstallation,
} from "@openmeld/adapter-claude-code";
import type { LocalExecutionSlots } from "@openmeld/local-service";
import { localAgentUpdateOperationSchema } from "@openmeld/schemas";
import type {
  LocalAgentUpdateOperation,
  LocalAgentUpdateRequest,
  LocalAgentUpdateState,
} from "@openmeld/schemas/types";
import {
  manageAgentRegistrationInstallation,
  resolveAgentTargetState,
} from "../../agents/registry";

// The Execution Host is the lane's single writer. Receipts survive socket and
// Host loss; an unfinished receipt never authorizes an installer replay.
export function createLocalAgentUpdater(input: {
  rootDir: string;
  slots: LocalExecutionSlots;
  refresh(): Promise<unknown>;
  log(message: string): void;
}) {
  const active = new Set<string>();
  let tail: Promise<unknown> = Promise.resolve();
  const directory = join(input.rootDir, "local-agent-updates");
  const path = join(directory, "operations.json");
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run, run);
    tail = next.catch(() => undefined);
    return next;
  };
  async function read(): Promise<LocalAgentUpdateOperation[]> {
    try {
      return localAgentUpdateOperationSchema
        .array()
        .parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw new Error(
        "agents.update_receipt_unavailable: Update history could not be read. Check OpenMeld Service diagnostics.",
        { cause: error }
      );
    }
  }
  async function save(operation: LocalAgentUpdateOperation) {
    const records = await read();
    const index = records.findIndex(
      (record) => record.operationId === operation.operationId
    );
    if (index < 0) {
      records.push(operation);
    } else {
      records[index] = operation;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, JSON.stringify(records), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  function project(
    operation: LocalAgentUpdateOperation | undefined
  ): LocalAgentUpdateOperation | null {
    if (!operation) {
      return null;
    }
    return operation.status === "running" && !active.has(operation.operationId)
      ? {
          ...operation,
          status: "outcome_unknown",
          message:
            "OpenMeld Service restarted before the update was confirmed. Check the installation in your terminal before updating again.",
        }
      : operation;
  }
  async function command(agentId: string, installationId?: string) {
    if (agentId !== "claude-code") {
      return null;
    }
    const installations = await manageAgentRegistrationInstallation({
      agentId,
      operation: "list",
    });
    if (
      !installations.selectedInstallationId ||
      (installationId &&
        installationId !== installations.selectedInstallationId)
    ) {
      return null;
    }
    const state = await resolveAgentTargetState(agentId);
    const contract = state?.registration?.launchContract;
    return contract ? await resolveClaudeNativeUpdateCommand(contract) : null;
  }
  async function state(agentId: string): Promise<LocalAgentUpdateState> {
    const supported = Boolean(await command(agentId));
    // This first provider owns the only supported installer. Do not attach its
    // receipts to other providers or infer support from an advisory command.
    const records = agentId === "claude-code" ? await serialize(read) : [];
    return { supported, operation: project(records.at(-1)) };
  }
  async function start(
    agentId: string,
    request: LocalAgentUpdateRequest
  ): Promise<LocalAgentUpdateState> {
    let started!: (state: LocalAgentUpdateState) => void;
    let rejected!: (error: unknown) => void;
    const ready = new Promise<LocalAgentUpdateState>((resolve, reject) => {
      started = resolve;
      rejected = reject;
    });
    await serialize(async () => {
      const records = await read();
      const existing = records.find(
        (record) => record.operationId === request.operationId
      );
      if (existing) {
        if (
          agentId !== "claude-code" ||
          existing.installationId !== request.installationId
        ) {
          throw new Error(
            "agents.update_conflict: This update request belongs to a different installation."
          );
        }
        started({ supported: true, operation: project(existing) });
        return;
      }
      if (
        records.some(
          (record) =>
            record.status === "running" || record.status === "outcome_unknown"
        )
      ) {
        throw new Error(
          "agents.update_unconfirmed: An earlier update has not been confirmed. Check its status before updating again."
        );
      }
      const executable = await command(agentId, request.installationId);
      if (!executable) {
        throw new Error(
          "agents.update_unsupported: This installation cannot be updated from OpenMeld. Use its original installer."
        );
      }
      // Claim the existing idle guard synchronously. Persist before invoking the
      // vendor; return the receipt while the Host retains the guard until exit.
      const work = input.slots.runAdapterOperationIfIdle(agentId, async () => {
        const beforeVersion = await readClaudeNativeVersion(executable);
        const operation: LocalAgentUpdateOperation = {
          ...request,
          beforeVersion,
          afterVersion: null,
          status: "running",
          message: "Updating Claude Code. You can close this window.",
        };
        active.add(request.operationId);
        await save(operation);
        started({ supported: true, operation });
        // The transaction that admitted this operation must finish before its
        // completion uses the same store writer.
        try {
          if ((await command(agentId, request.installationId)) !== executable) {
            throw new Error(
              "The selected installation changed before the update started."
            );
          }
          await updateClaudeNativeInstallation(executable);
          if ((await command(agentId, request.installationId)) !== executable) {
            throw new Error(
              "The selected installation could not be confirmed after the update."
            );
          }
          const afterVersion = await readClaudeNativeVersion(executable);
          await serialize(() =>
            save({
              ...operation,
              afterVersion,
              status: "succeeded",
              message:
                beforeVersion === afterVersion
                  ? `No newer version was installed. Claude Code is still ${afterVersion}.`
                  : `Claude Code was updated from ${beforeVersion} to ${afterVersion}.`,
            })
          );
        } catch (error) {
          input.log(
            `Local agent update ${request.operationId} failed: ${error instanceof Error ? error.message : String(error)}`
          );
          await serialize(() =>
            save({
              ...operation,
              status: "outcome_unknown",
              message:
                "The update could not be verified. Check Claude Code in your terminal and OpenMeld Service diagnostics before trying again.",
            })
          );
        } finally {
          active.delete(request.operationId);
          await input.refresh();
        }
      });
      work.then(
        (result) => {
          if (!result.accepted) {
            rejected(
              new Error(
                result.status === "blocked_by_work"
                  ? "agents.update_blocked_by_work: Claude Code has work in progress. Wait until it finishes before updating."
                  : "agents.update_in_progress: This installation is already being changed. Check again shortly."
              )
            );
          }
        },
        (error) => {
          active.delete(request.operationId);
          input.log(
            `Local agent update ${request.operationId} could not complete: ${String(error)}`
          );
          rejected(error);
        }
      );
      await ready;
    });
    return ready;
  }
  return { state, start };
}
