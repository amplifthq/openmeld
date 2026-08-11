import { formatOpenMeldCliCommands } from "../../runtime/cli-entry-command";
import { classifyDaemonServiceWakeability } from "./daemon-service-anomaly-groups";
import type {
  DaemonServiceAnomalyCode,
  DaemonServiceInventory,
} from "./daemon-service-inventory";

export type DaemonServiceFreshnessStatus = "current" | "update_available";

export type DaemonServiceFreshnessWarning = {
  anomalyCodes: DaemonServiceAnomalyCode[];
  blocksWake: false;
  code: "service_update_available" | "service_repair_recommended";
  detailText: string;
  executionEvidenceSafe: boolean;
  level: "info" | "warning";
  nextStep: string;
  nextSteps: [string];
  status: "update_available";
  summaryText: "Update OpenMeld Service" | "Reconnect OpenMeld Service";
  title: "Update OpenMeld Service" | "Reconnect OpenMeld Service";
};

const UPDATE_AVAILABLE_ANOMALIES = new Set<DaemonServiceAnomalyCode>([
  "version_outdated",
  "bundle_content_drift",
  "bundle_version_drift",
  "bundle_strategy_legacy",
]);
const OPENMELD_COMMAND_PREFIX_RE = /^openmeld/u;

export function resolveDaemonServiceFreshnessWarning(input: {
  cliEntry?: string | null;
  inventory?: DaemonServiceInventory | null;
}): DaemonServiceFreshnessWarning | null {
  const inventory = input.inventory;
  if (!inventory) {
    return null;
  }

  const wakeability = classifyDaemonServiceWakeability({ inventory });
  if (wakeability.blocksWake || wakeability.advisoryCodes.length === 0) {
    return null;
  }

  return resolveDaemonServiceFreshnessWarningForAnomalyCodes({
    anomalyCodes: wakeability.advisoryCodes,
    cliEntry: input.cliEntry,
    executionEvidenceSafe: wakeability.executionEvidenceSafe,
  });
}

export function resolveDaemonServiceFreshnessWarningForAnomalyCodes(input: {
  anomalyCodes: readonly DaemonServiceAnomalyCode[];
  cliEntry?: string | null;
  executionEvidenceSafe?: boolean;
}): DaemonServiceFreshnessWarning | null {
  const anomalyCodes = dedupeAnomalyCodes(input.anomalyCodes);
  if (anomalyCodes.length === 0) {
    return null;
  }
  const usesUpdateCommand = anomalyCodes.some((code) =>
    UPDATE_AVAILABLE_ANOMALIES.has(code)
  );
  const command = formatServiceCommand({
    cliEntry: input.cliEntry,
    command: "openmeld setup",
  });

  if (usesUpdateCommand) {
    return {
      anomalyCodes,
      blocksWake: false,
      code: "service_update_available",
      detailText:
        "OpenMeld Service is running, but its local service bundle is not current. Update OpenMeld Service before this computer receives new local Wake work.",
      executionEvidenceSafe: input.executionEvidenceSafe ?? true,
      level: "info",
      nextStep: `Run \`${command}\` to update OpenMeld Service.`,
      nextSteps: [command],
      status: "update_available",
      summaryText: "Update OpenMeld Service",
      title: "Update OpenMeld Service",
    };
  }

  return {
    anomalyCodes,
    blocksWake: false,
    code: "service_repair_recommended",
    detailText:
      "OpenMeld Service is running, but its local service setup does not fully match this OpenMeld lane. Reconnect OpenMeld Service before this computer receives new local Wake work.",
    executionEvidenceSafe: input.executionEvidenceSafe ?? true,
    level: "warning",
    nextStep: `Run \`${command}\` to reconnect OpenMeld Service.`,
    nextSteps: [command],
    status: "update_available",
    summaryText: "Reconnect OpenMeld Service",
    title: "Reconnect OpenMeld Service",
  };
}

export function buildDaemonServiceFreshnessPromptLines(
  warning: DaemonServiceFreshnessWarning | null | undefined
): string[] {
  if (!warning) {
    return [];
  }
  return [`- Service freshness: ${warning.detailText} ${warning.nextStep}`];
}

function dedupeAnomalyCodes(
  anomalyCodes: readonly DaemonServiceAnomalyCode[]
): DaemonServiceAnomalyCode[] {
  return [...new Set(anomalyCodes)];
}

function formatServiceCommand(input: {
  cliEntry?: string | null;
  command: "openmeld setup";
}): string {
  const cliEntry = String(input.cliEntry ?? "").trim();
  if (cliEntry) {
    return input.command.replace(OPENMELD_COMMAND_PREFIX_RE, cliEntry);
  }
  const [command] = formatOpenMeldCliCommands([input.command]) as [string];
  return command;
}
