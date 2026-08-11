import { isCancel, select } from "@clack/prompts";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
} from "../runtime/cli-entry-command";

export const DAEMON_INSTALL_DECISION_CHOICE = {
  install: "install",
  notNow: "not_now",
} as const;

export type DaemonInstallDecisionKind = "missing" | "outdated";

export type DaemonInstallDecisionChoice =
  | (typeof DAEMON_INSTALL_DECISION_CHOICE)[keyof typeof DAEMON_INSTALL_DECISION_CHOICE]
  | "cancelled";

type DaemonVersionInput = {
  installedVersion?: string;
  expectedVersion: string;
};

type DaemonInstallDecisionPromptConfig = {
  message: string;
  initialValue: (typeof DAEMON_INSTALL_DECISION_CHOICE)["install"];
  options: Array<{
    value:
      | (typeof DAEMON_INSTALL_DECISION_CHOICE)["install"]
      | (typeof DAEMON_INSTALL_DECISION_CHOICE)["notNow"];
    label: string;
    hint?: string;
  }>;
};

const DAEMON_INSTALL_COMMAND = "openmeld service install";
const DAEMON_REPAIR_COMMAND = "openmeld service repair";
const DAEMON_UPGRADE_COMMAND = "openmeld upgrade";
const DAEMON_AUTO_INSTALL_ALWAYS_FLAG = "`--service-auto-install always`";
const DAEMON_DECISION_RECOMMENDED_HINT = "Recommended";

const DAEMON_INSTALL_DECISION_COPY = {
  missing: {
    question: "OpenMeld Service is missing. Install it now?",
    explanation: "Without it, this computer can't receive local Wake work.",
    primaryLabel: "Yes, install it for me",
    deferred:
      "OpenMeld Service is still missing. Install it later with `openmeld service install` so this computer can receive local Wake work.",
    failed:
      "OpenMeld Service could not be installed. Run `openmeld service install` so this computer can receive local Wake work.",
  },
  outdated: {
    question: "OpenMeld Service update required. Update it now?",
    explanation:
      "This service artifact is not compatible with current local Wake execution.",
    primaryLabel: "Yes, update it for me",
    deferred:
      "OpenMeld Service update skipped. Run `openmeld service update` before using local Wake work.",
    failed: "OpenMeld Service was not updated. Run `openmeld service update`.",
  },
} as const satisfies Record<
  DaemonInstallDecisionKind,
  {
    question: string;
    explanation: string;
    primaryLabel: string;
    deferred: string;
    failed: string;
  }
>;

export function buildDaemonInstallDecisionPromptConfig(input: {
  kind: DaemonInstallDecisionKind;
  installedVersion?: string;
  expectedVersion?: string;
}): DaemonInstallDecisionPromptConfig {
  const copy = DAEMON_INSTALL_DECISION_COPY[input.kind];
  const detailLine =
    input.kind === "outdated" &&
    typeof input.installedVersion === "string" &&
    typeof input.expectedVersion === "string"
      ? `Installed v${input.installedVersion}, expected v${input.expectedVersion}.`
      : null;
  return {
    message: [copy.question, copy.explanation, detailLine]
      .filter((line) => typeof line === "string" && line.length > 0)
      .join("\n"),
    initialValue: DAEMON_INSTALL_DECISION_CHOICE.install,
    options: [
      {
        value: DAEMON_INSTALL_DECISION_CHOICE.install,
        label: copy.primaryLabel,
        hint: DAEMON_DECISION_RECOMMENDED_HINT,
      },
      {
        value: DAEMON_INSTALL_DECISION_CHOICE.notNow,
        label: "Not now",
      },
    ],
  };
}

export async function promptForDaemonInstallDecision(input: {
  kind: DaemonInstallDecisionKind;
  installedVersion?: string;
  expectedVersion?: string;
}): Promise<DaemonInstallDecisionChoice> {
  const choice = await select(buildDaemonInstallDecisionPromptConfig(input));
  if (isCancel(choice)) {
    return "cancelled";
  }
  return choice === DAEMON_INSTALL_DECISION_CHOICE.install
    ? DAEMON_INSTALL_DECISION_CHOICE.install
    : DAEMON_INSTALL_DECISION_CHOICE.notNow;
}

export async function runDaemonInstallDecisionPrompt(input: {
  kind: DaemonInstallDecisionKind;
  installedVersion?: string;
  expectedVersion?: string;
  emitLine: (text: string) => Promise<void> | void;
  installService: () => Promise<void>;
}): Promise<"install" | "not_now" | "cancelled" | "failed"> {
  const decision = await promptForDaemonInstallDecision({
    kind: input.kind,
    installedVersion: input.installedVersion,
    expectedVersion: input.expectedVersion,
  });
  if (decision === DAEMON_INSTALL_DECISION_CHOICE.install) {
    try {
      await input.installService();
      return "install";
    } catch {
      await input.emitLine(formatDaemonInstallFailedMessage(input.kind));
      return "failed";
    }
  }

  if (decision === "cancelled") {
    return "cancelled";
  }

  await input.emitLine(formatDaemonInstallDeferredMessage(input.kind));
  return decision;
}

export function formatDaemonInstallDeferredMessage(
  kind: DaemonInstallDecisionKind
): string {
  return formatInlineOpenMeldCliCommands(
    DAEMON_INSTALL_DECISION_COPY[kind].deferred
  );
}

export function formatDaemonInstallFailedMessage(
  kind: DaemonInstallDecisionKind
): string {
  return formatInlineOpenMeldCliCommands(
    DAEMON_INSTALL_DECISION_COPY[kind].failed
  );
}

export function formatDaemonServiceMissingRecommendation(): string {
  return "OpenMeld Service is not installed yet. Install it so this computer can receive local Wake work.";
}

export function formatDaemonServiceInstallRecommendationNextStep(): string {
  return `Run \`${formatOpenMeldCliCommand(DAEMON_INSTALL_COMMAND)}\` now, or re-run command with ${DAEMON_AUTO_INSTALL_ALWAYS_FLAG}.`;
}

export function formatDaemonServiceMissingStatus(): string {
  return "Not installed yet.";
}

export function formatDaemonServiceMissingMeaning(): string {
  return "Missing — install OpenMeld Service before this computer can receive local Wake work.";
}

export function formatDaemonServiceMissingAction(): string {
  return `Run \`${formatOpenMeldCliCommand(DAEMON_INSTALL_COMMAND)}\` to set it up.`;
}

export function formatDaemonServiceMissingRunStepOne(): string {
  return `\`${formatOpenMeldCliCommand(DAEMON_INSTALL_COMMAND)}\``;
}

export function formatDaemonServiceMissingRunStepTwo(): string {
  return `\`${formatOpenMeldCliCommand("openmeld service start")}\``;
}

export function formatDaemonServiceOutdatedRecommendation(
  input: DaemonVersionInput
): string {
  const installedVersion = input.installedVersion ?? "unknown";
  return `OpenMeld Service version differs from this CLI (installed v${installedVersion}, CLI v${input.expectedVersion}). This is diagnostic unless service compatibility fails.`;
}

export function formatDaemonServiceOutdatedStatus(
  input: DaemonVersionInput
): string {
  const installedVersion = input.installedVersion ?? "unknown";
  return `Version differs from this CLI (installed v${installedVersion}, CLI v${input.expectedVersion}).`;
}

export function formatDaemonServiceDowngradeBlockedRecommendation(
  input: DaemonVersionInput
): string {
  if (input.installedVersion) {
    return `OpenMeld Service is already newer (installed v${input.installedVersion}, current CLI v${input.expectedVersion}). OpenMeld will not downgrade it automatically. Run \`${formatOpenMeldCliCommand(DAEMON_UPGRADE_COMMAND)}\`.`;
  }
  return `OpenMeld Service is already newer than this CLI. OpenMeld will not downgrade it automatically. Run \`${formatOpenMeldCliCommand(DAEMON_UPGRADE_COMMAND)}\`.`;
}

export function getDaemonDowngradeBlockedTitle(): string {
  return "⛔ OpenMeld Service Downgrade Blocked";
}

export function formatDaemonDowngradeBlockedNextStep(): string {
  return `Run \`${formatOpenMeldCliCommand(DAEMON_UPGRADE_COMMAND)}\`.`;
}

export function formatDaemonStartupRepairNotice(): string {
  return `Run \`${formatOpenMeldCliCommand(DAEMON_REPAIR_COMMAND)}\` to repair it now.`;
}
