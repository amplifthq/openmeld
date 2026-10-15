import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  installGrokBotTools,
  isManagedGrokBotSignedIn,
  loginManagedGrokBot,
  readManagedGrokBotCandidate,
  supportsGrokBotSetup,
} from "@openmeld/adapter-grok-bot";
import type { LocalExecutionSlots } from "@openmeld/local-service";
import { localAgentSetupOperationSchema } from "@openmeld/schemas";
import type {
  LocalAgentSetupOperation,
  LocalAgentSetupRequest,
  LocalAgentSetupState,
} from "@openmeld/schemas/types";
import {
  listAgentTargetStates,
  manageAgentRegistrationInstallation,
  reconcileNewRunnableBuiltinAgentRegistrations,
  setAgentRegistrationEnabled,
} from "../../agents/registry";

export function createLocalAgentSetup(input: {
  rootDir: string;
  slots: LocalExecutionSlots;
  refresh(): Promise<unknown>;
  log(message: string): void;
}) {
  const directory = join(input.rootDir, "connection-tools", "grok-bot");
  const receipt = join(directory, "setup.json");
  let active: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => undefined);
    return next;
  };
  async function readAll(): Promise<LocalAgentSetupOperation[]> {
    try {
      return localAgentSetupOperationSchema
        .array()
        .parse(JSON.parse(await readFile(receipt, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw new Error(
        "Connection setup history could not be read. Check Service diagnostics."
      );
    }
  }
  async function read() {
    return (await readAll()).at(-1) ?? null;
  }
  async function save(operation: LocalAgentSetupOperation) {
    const records = await readAll();
    const index = records.findIndex(
      (entry) => entry.operationId === operation.operationId
    );
    if (index < 0) {
      records.push(operation);
    } else {
      records[index] = operation;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(`${receipt}.tmp`, JSON.stringify(records), { mode: 0o600 });
    await rename(`${receipt}.tmp`, receipt);
  }
  async function state(): Promise<LocalAgentSetupState> {
    const operation = await read();
    const installed = Boolean(await readManagedGrokBotCandidate(input.rootDir));
    return {
      supported: supportsGrokBotSetup(),
      installed,
      signedIn:
        installed &&
        active === null &&
        (await isManagedGrokBotSignedIn(input.rootDir)),
      operation:
        operation?.status === "running" && active !== operation.operationId
          ? {
              ...operation,
              status: "outcome_unknown",
              message:
                "Service restarted before setup was confirmed. Check the connection before trying again.",
            }
          : operation,
    };
  }
  function start(
    request: LocalAgentSetupRequest
  ): Promise<LocalAgentSetupState> {
    return serialize(async () => {
      const records = await readAll();
      const repeated = records.find(
        (entry) => entry.operationId === request.operationId
      );
      const existing = records.at(-1);
      if (repeated) {
        if (repeated.action !== request.action) {
          throw new Error("This request belongs to a different setup action.");
        }
        return state();
      }
      if (
        existing?.status === "running" ||
        existing?.status === "outcome_unknown"
      ) {
        throw new Error(
          "Earlier setup has not finished. Check its status before starting again."
        );
      }
      if (!supportsGrokBotSetup()) {
        throw new Error("Use the setup guide on this platform.");
      }
      if (
        request.action === "login" &&
        !(await readManagedGrokBotCandidate(input.rootDir))
      ) {
        throw new Error("Install connection tools first.");
      }
      let accepted!: () => void;
      let rejected!: (error: unknown) => void;
      const ready = new Promise<void>((resolve, reject) => {
        accepted = resolve;
        rejected = reject;
      });
      const work = input.slots.runAdapterOperationIfIdle(
        "grok-bot",
        async () => {
          const operation: LocalAgentSetupOperation = {
            operationId: request.operationId,
            action: request.action,
            status: "running",
            message:
              request.action === "install"
                ? "Installing connection tools. You can keep using OpenMeld."
                : "Finish sign-in in the browser on this computer. You can close this dialog.",
          };
          active = request.operationId;
          try {
            await save(operation);
            accepted();
            if (request.action === "install") {
              await installGrokBotTools(input.rootDir);
            } else {
              await loginManagedGrokBot(input.rootDir);
            }
            await reconcileNewRunnableBuiltinAgentRegistrations({
              states: (await listAgentTargetStates()).filter(
                (item) => item.agentId === "grok-bot"
              ),
            });
            await manageAgentRegistrationInstallation({
              agentId: "grok-bot",
              operation: "select",
              installationId: "openmeld-managed-grok-bot",
            });
            await setAgentRegistrationEnabled({
              agentId: "grok-bot",
              enabled: true,
            });
            await save({
              ...operation,
              status: "succeeded",
              message:
                request.action === "install"
                  ? "Connection tools installed. Sign in to connect your Bot."
                  : "Signed in. Continue connecting your Bot.",
            });
          } catch (error) {
            rejected(error);
            await save({
              ...operation,
              status: "failed",
              message:
                error instanceof Error
                  ? error.message.slice(0, 1024)
                  : "Setup failed. Try again.",
            });
          } finally {
            active = null;
          }
        }
      );
      work
        .then(async (result) => {
          if (!result.accepted) {
            rejected(
              new Error(
                "Grok Bot has work or setup in progress. Wait for it to finish."
              )
            );
            return;
          }
          // Refresh can replace the Host after its controller changes. Persist
          // the result and release the adapter slot before that lifecycle work.
          await input.refresh();
        })
        .catch((error: unknown) => {
          rejected(error);
          input.log(
            "Connection setup could not complete. Check Service diagnostics."
          );
        });
      await ready;
      return state();
    });
  }
  return { state, start };
}
