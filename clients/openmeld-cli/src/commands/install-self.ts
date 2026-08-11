import { dirname } from "node:path";
import process from "node:process";
import {
  activateManagedCliCommand,
  getManagedCliCommandActivationNotice,
} from "../local-components/managed-command-activation";
import {
  buildInstallSelfJsonPayload,
  type CliInstallSelfOutcome,
  performManagedInstall,
} from "../local-components/managed-install";

export async function runInstallSelf(input: {
  json: boolean;
  force: boolean;
}): Promise<void> {
  const outcome = await performManagedInstall({ force: input.force });
  await activateManagedCommandOrWarn(outcome);
  if (input.json) {
    process.stdout.write(
      `${JSON.stringify(buildInstallSelfJsonPayload(outcome))}\n`
    );
    return;
  }
  process.stdout.write(formatInstallSelfHuman(outcome));
}

async function activateManagedCommandOrWarn(
  outcome: CliInstallSelfOutcome
): Promise<void> {
  try {
    const activation = await activateManagedCliCommand({});
    const activationNotice = getManagedCliCommandActivationNotice(activation);
    if (activationNotice) {
      process.stderr.write(`${activationNotice}\n`);
    }
    if (activation.status === "unsupported_shell") {
      process.stderr.write(
        `OpenMeld installed the CLI, but could not add the openmeld command to this shell automatically. Add ${dirname(outcome.currentPointerPath)} to your shell PATH.\n`
      );
    }
  } catch (error) {
    process.stderr.write(
      `OpenMeld installed the CLI, but could not update your shell PATH: ${toErrorMessage(error)}. The managed command is ${outcome.currentPointerPath}.\n`
    );
  }
}

function formatInstallSelfHuman(outcome: CliInstallSelfOutcome): string {
  if (outcome.result === "installed") {
    return `Installed OpenMeld CLI ${outcome.version} at ${outcome.managedBinaryPath} (current: ${outcome.currentPointerPath}).\n`;
  }
  if (outcome.result === "noop_same_version") {
    return `OpenMeld CLI ${outcome.version} is already installed. Nothing to do.\n`;
  }
  return `A newer OpenMeld CLI (${outcome.previousVersion}) is already installed; keeping it. Use --force to install ${outcome.version} anyway.\n`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
