import { isCancel, select } from "@clack/prompts";
import type { DaemonServiceRuntimeStatus } from "../config/daemon-state";
import {
  buildDaemonServiceRefreshNextStep,
  buildDaemonServiceRefreshPromptMessage,
} from "../local-service/lifecycle/daemon-service-repair-guidance";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";

export const DAEMON_START_DECISION_CHOICE = {
  start: "start",
  notNow: "not_now",
} as const;

export type DaemonStartDecisionChoice =
  | (typeof DAEMON_START_DECISION_CHOICE)[keyof typeof DAEMON_START_DECISION_CHOICE]
  | "cancelled";

export type DaemonStartServiceDecisionOutcome =
  | "started"
  | "failed"
  | "failed_with_card"
  | "deferred_with_card"
  | "cancelled";

export type DaemonStartDecisionPromptConfig = {
  message: string;
  initialValue: (typeof DAEMON_START_DECISION_CHOICE)["start"];
  options: Array<{
    value:
      | (typeof DAEMON_START_DECISION_CHOICE)["start"]
      | (typeof DAEMON_START_DECISION_CHOICE)["notNow"];
    label: string;
    hint?: string;
  }>;
};

export const DAEMON_REPAIR_DECISION_CHOICE = {
  repair: "repair",
  notNow: "not_now",
} as const;

export type DaemonRepairDecisionChoice =
  | (typeof DAEMON_REPAIR_DECISION_CHOICE)[keyof typeof DAEMON_REPAIR_DECISION_CHOICE]
  | "cancelled";

export type DaemonRepairDecisionPromptConfig = {
  message: string;
  initialValue: (typeof DAEMON_REPAIR_DECISION_CHOICE)["repair"];
  options: Array<{
    value:
      | (typeof DAEMON_REPAIR_DECISION_CHOICE)["repair"]
      | (typeof DAEMON_REPAIR_DECISION_CHOICE)["notNow"];
    label: string;
    hint?: string;
  }>;
};

export type DaemonStartDecisionCard = {
  title: string;
  rows: Array<{
    label: string;
    value: string;
  }>;
};

const DAEMON_START_DECISION_QUESTION =
  "OpenMeld Service is not running. Start it now?";
const DAEMON_START_DECISION_EXPLANATION =
  "Without it, this computer can't receive local Wake work.";
const DAEMON_START_DECISION_START_LABEL = "Yes, start it for me";
const DAEMON_START_DECISION_NOT_NOW_LABEL = "Not now";
const DAEMON_START_DECISION_RECOMMENDED_HINT = "Recommended";
const DAEMON_REPAIR_DECISION_REPAIR_LABEL = "Yes, reconnect it for me";
const DAEMON_START_RUN_COMMAND = "openmeld service start";
const DAEMON_START_STATUS_COMMAND = "openmeld service status";
const DAEMON_START_STOP_COMMAND = "openmeld service stop";

export function buildDaemonStartDecisionPromptConfig(): DaemonStartDecisionPromptConfig {
  return {
    message: `${DAEMON_START_DECISION_QUESTION}\n${DAEMON_START_DECISION_EXPLANATION}`,
    initialValue: DAEMON_START_DECISION_CHOICE.start,
    options: [
      {
        value: DAEMON_START_DECISION_CHOICE.start,
        label: DAEMON_START_DECISION_START_LABEL,
        hint: DAEMON_START_DECISION_RECOMMENDED_HINT,
      },
      {
        value: DAEMON_START_DECISION_CHOICE.notNow,
        label: DAEMON_START_DECISION_NOT_NOW_LABEL,
      },
    ],
  };
}

export async function promptForDaemonStartDecision(): Promise<DaemonStartDecisionChoice> {
  const choice = await select(buildDaemonStartDecisionPromptConfig());
  if (isCancel(choice)) {
    return "cancelled";
  }
  return choice === DAEMON_START_DECISION_CHOICE.start
    ? DAEMON_START_DECISION_CHOICE.start
    : DAEMON_START_DECISION_CHOICE.notNow;
}

export function buildDaemonRepairDecisionPromptConfig(): DaemonRepairDecisionPromptConfig {
  return {
    message: `${buildDaemonServiceRefreshPromptMessage()}\nReconnect it now?`,
    initialValue: DAEMON_REPAIR_DECISION_CHOICE.repair,
    options: [
      {
        value: DAEMON_REPAIR_DECISION_CHOICE.repair,
        label: DAEMON_REPAIR_DECISION_REPAIR_LABEL,
        hint: DAEMON_START_DECISION_RECOMMENDED_HINT,
      },
      {
        value: DAEMON_REPAIR_DECISION_CHOICE.notNow,
        label: DAEMON_START_DECISION_NOT_NOW_LABEL,
      },
    ],
  };
}

export async function promptForDaemonRepairDecision(): Promise<DaemonRepairDecisionChoice> {
  const choice = await select(buildDaemonRepairDecisionPromptConfig());
  if (isCancel(choice)) {
    return "cancelled";
  }
  return choice === DAEMON_REPAIR_DECISION_CHOICE.repair
    ? DAEMON_REPAIR_DECISION_CHOICE.repair
    : DAEMON_REPAIR_DECISION_CHOICE.notNow;
}

export async function runDaemonStartDecisionPrompt(input: {
  startService: () => Promise<
    undefined | boolean | DaemonStartServiceDecisionOutcome
  >;
}): Promise<
  | "started"
  | "not_now"
  | "cancelled"
  | "failed"
  | "failed_with_card"
  | "deferred_with_card"
> {
  const decision = await promptForDaemonStartDecision();
  if (decision === DAEMON_START_DECISION_CHOICE.start) {
    try {
      const result = await input.startService();
      if (result === false || result === "failed") {
        return "failed";
      }
      if (result === "failed_with_card") {
        return "failed_with_card";
      }
      if (result === "deferred_with_card") {
        return "deferred_with_card";
      }
      if (result === "cancelled") {
        return "cancelled";
      }
      return "started";
    } catch {
      return "failed";
    }
  }

  if (decision === "cancelled") {
    return "cancelled";
  }

  return decision;
}

export function shouldOfferDaemonStartDecision(
  runtimeStatus: DaemonServiceRuntimeStatus["status"] | null | undefined
): boolean {
  return runtimeStatus === "not_running" || runtimeStatus === "stale";
}

export function buildDaemonStartDeferredCard(): DaemonStartDecisionCard {
  return {
    title: "⚪ OpenMeld Service Is Off",
    rows: [
      {
        label: "⚪ Status",
        value: "off for now",
      },
      {
        label: "📡 Local Service Link",
        value: "Off — OpenMeld Service is not connected for local Wake work.",
      },
      {
        label: "🔧 Next",
        value: `Start later with \`${formatOpenMeldCliCommand(
          DAEMON_START_RUN_COMMAND
        )}\`.`,
      },
    ],
  };
}

export function buildDaemonStartNeedsAttentionCard(input: {
  summary: string;
  nextStep?: string;
  autoRepairAttempted?: boolean;
  detail?: string;
}): DaemonStartDecisionCard {
  return {
    title: "⚠️ OpenMeld Service Needs Attention",
    rows: [
      {
        label: "❌ Status",
        value: "not running",
      },
      ...(input.autoRepairAttempted
        ? [
            {
              label: "🩹 Automatic Repair",
              value:
                "OpenMeld tried one automatic repair automatically, but the service still needs help.",
            },
          ]
        : []),
      {
        label: "📝 Found",
        value: input.summary,
      },
      ...(input.detail
        ? [
            {
              label: "🧾 Last local detail",
              value: input.detail,
            },
          ]
        : []),
      {
        label: "📡 Local Service Link",
        value: "Off — OpenMeld Service is not connected for local Wake work.",
      },
      {
        label: "🔧 Next",
        value: input.nextStep ?? buildDaemonServiceRefreshNextStep(),
      },
    ],
  };
}

export function getDaemonStartStartedTitle(): string {
  return "✅ OpenMeld Service Started";
}

export function formatDaemonStartStartedStatus(): string {
  return "running";
}

export function formatDaemonStartAutoRepairResolvedMessage(): string {
  return "OpenMeld fixed one local startup issue automatically. No action needed.";
}

export function formatDaemonStartStartedMeaning(): string {
  return "OpenMeld Service is running on this device. Cloud connection may still be reconnecting.";
}

export function formatDaemonStartStartedManage(): string {
  return `Check it any time with \`${formatOpenMeldCliCommand(
    DAEMON_START_STATUS_COMMAND
  )}\` without stopping it. Stop it any time with \`${formatOpenMeldCliCommand(
    DAEMON_START_STOP_COMMAND
  )}\`.`;
}

export function formatDaemonStartStartedNextStep(): string {
  return "Use `openmeld service status` if you want to check the local service link and cloud connection.";
}
