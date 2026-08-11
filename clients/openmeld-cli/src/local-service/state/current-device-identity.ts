import { localAgentCatalogSchema } from "@openmeld/schemas";
import type {
  LocalAgentCatalog,
  LocalAgentCatalogSelectableReason,
} from "@openmeld/schemas/types";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import type { StartReadinessSnapshot } from "../../start-local/readiness-types";
import {
  ensureDaemonRuntimePaths,
  resolveDaemonDeviceId,
} from "./daemon-device-id";

type LocalAgentCatalogEntry = LocalAgentCatalog["entries"][number];

export function buildLocalAgentCatalogFromReadiness(
  readiness: StartReadinessSnapshot
): LocalAgentCatalog {
  const entries = readiness.agents.candidates.map(
    buildLocalAgentCatalogEntryFromCandidate
  );
  const catalog: LocalAgentCatalog = {
    ...summarizeLocalAgentCatalogEntries(entries),
    entries,
  };
  const parsed = localAgentCatalogSchema.safeParse(catalog);
  if (!parsed.success) {
    throw new Error(
      `OpenMeld setup built an invalid local-agent catalog before reporting it: ${formatLocalAgentCatalogValidationError(
        parsed.error.issues
      )}`
    );
  }
  return parsed.data;
}

function buildLocalAgentCatalogEntryFromCandidate(
  candidate: StartReadinessSnapshot["agents"]["candidates"][number]
): LocalAgentCatalogEntry {
  if (candidate.lifecycleStatus === "suspended") {
    return {
      agentId: candidate.agentId,
      displayName: candidate.displayName,
      targetKind: "builtin",
      detected: candidate.detected,
      enabled: candidate.enabled,
      launchStatus: "not_available",
      selectable: false,
      selectableReason: candidate.detected
        ? "not_supported_yet"
        : "not_detected",
    };
  }
  if (candidate.launchStatus === "needs_repair" && !candidate.enabled) {
    return {
      agentId: candidate.agentId,
      displayName: candidate.displayName,
      targetKind: "builtin",
      detected: candidate.detected,
      enabled: candidate.enabled,
      launchStatus: "not_available",
      selectable: false,
      selectableReason: "needs_repair",
    };
  }
  return {
    agentId: candidate.agentId,
    displayName: candidate.displayName,
    targetKind: "builtin",
    detected: candidate.detected,
    enabled: candidate.enabled,
    launchStatus: candidate.launchStatus,
    selectable: candidate.selectable,
    selectableReason: normalizeSelectableReason(candidate.selectableReason),
  };
}

function summarizeLocalAgentCatalogEntries(
  entries: LocalAgentCatalogEntry[]
): Omit<LocalAgentCatalog, "entries"> {
  return {
    totalBuiltins: entries.length,
    detectedSupported: entries.filter(
      (entry) => entry.detected && entry.launchStatus === "ready"
    ).length,
    needsChoice: entries.filter(
      (entry) => entry.detected && entry.launchStatus === "needs_choice"
    ).length,
    needsRepair: entries.filter(
      (entry) => entry.detected && entry.launchStatus === "needs_repair"
    ).length,
    detectedNotSupportedYet: entries.filter(
      (entry) =>
        entry.detected &&
        entry.launchStatus === "not_available" &&
        entry.selectableReason === "not_supported_yet"
    ).length,
    notDetected: entries.filter((entry) => !entry.detected).length,
  };
}

export async function readCurrentLocalDeviceId(
  input: {
    serviceContract?: Awaited<ReturnType<typeof readDaemonServiceContract>>;
  } = {}
): Promise<string | null> {
  const serviceContract =
    input.serviceContract === undefined
      ? await readDaemonServiceContract().catch(() => null)
      : input.serviceContract;
  const contractDeviceId = serviceContract?.deviceId;
  if (typeof contractDeviceId === "string" && contractDeviceId.trim().length) {
    return contractDeviceId.trim();
  }

  const runtimePaths = await ensureDaemonRuntimePaths();
  return await resolveDaemonDeviceId({
    deviceIdPath: runtimePaths.deviceIdPath,
  });
}

function normalizeSelectableReason(
  selectableReason: StartReadinessSnapshot["agents"]["candidates"][number]["selectableReason"]
): LocalAgentCatalogSelectableReason | null {
  switch (selectableReason) {
    case null:
    case "not_detected":
    case "not_supported_yet":
    case "needs_repair":
    case "custom_coming_soon":
      return selectableReason;
    default: {
      const unexpectedSelectableReason: never = selectableReason;
      throw new Error(
        `Unsupported local-agent selectableReason: ${unexpectedSelectableReason}`
      );
    }
  }
}

function formatLocalAgentCatalogValidationError(
  issues: readonly { message: string; path: PropertyKey[] }[]
): string {
  return issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "catalog";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
