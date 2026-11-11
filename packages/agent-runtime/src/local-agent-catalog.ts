import agentsRegistryDocument from "../../../config/agents/registry.json";
import { parseAgentControllerRef } from "./agent-controller-ref";

// Keep this as the canonical projection policy. The output shape must stay
// aligned with packages/schemas localAgentCatalogSchema without making this
// schema-free policy package depend on schemas.
export type LocalAgentCatalogCapabilityStatus =
  | "ready"
  | "not_ready"
  | "stale"
  | "unknown";

export type LocalAgentCatalogCapability = {
  agentControllerRef: string;
  enabled?: boolean;
  reasonCodes?: readonly string[];
  status: LocalAgentCatalogCapabilityStatus;
};

export type LocalAgentCatalogEntryProjection = {
  agentId: string;
  detected: boolean;
  displayName: string;
  enabled: boolean;
  lifecycleStatus: "active" | "suspended";
  launchStatus: "ready" | "needs_choice" | "needs_repair" | "not_available";
  selectable: boolean;
  selectableReason:
    | "not_detected"
    | "not_supported_yet"
    | "needs_repair"
    | "custom_coming_soon"
    | null;
  targetKind: "builtin" | "custom";
};

export type LocalAgentCatalogProjection = {
  detectedNotSupportedYet: number;
  detectedSupported: number;
  entries: LocalAgentCatalogEntryProjection[];
  needsChoice: number;
  needsRepair: number;
  notDetected: number;
  totalBuiltins: number;
};

type BuiltinLocalAgentCatalogDefinition = {
  agentId: string;
  displayName: string;
  lifecycleStatus: "active" | "suspended";
  runtimeSupported: boolean;
};

type RegistryDocumentLike = {
  agents?: unknown;
};

type RegistryAgentLike = {
  category?: unknown;
  displayName?: unknown;
  id?: unknown;
  lifecycle?: unknown;
  runtime?: unknown;
};

type RegistryLifecycleLike = {
  status?: unknown;
};

type RegistryRuntimeLike = {
  supported?: unknown;
};

const BUILTIN_LOCAL_AGENT_CATALOG_DEFINITIONS =
  readBuiltinLocalAgentCatalogDefinitions();
const AGENT_ID_WORD_SEPARATOR_RE = /[-_]+/u;

export function projectLocalAgentCatalogFromCapabilities(input: {
  capabilities: readonly LocalAgentCatalogCapability[];
}): LocalAgentCatalogProjection {
  const capabilityByRef = new Map(
    input.capabilities.flatMap((capability) => {
      const parsed = parseAgentControllerRef(capability.agentControllerRef);
      return parsed ? [[parsed.ref, capability] as const] : [];
    })
  );
  const entries: LocalAgentCatalogEntryProjection[] = [
    ...BUILTIN_LOCAL_AGENT_CATALOG_DEFINITIONS.map((definition) =>
      projectBuiltinLocalAgentCatalogEntry({
        capability:
          capabilityByRef.get(`builtin:${definition.agentId}`) ?? null,
        definition,
      })
    ),
    ...projectCustomLocalAgentCatalogEntries({
      capabilities: input.capabilities,
      knownAgentControllerRefs: new Set(capabilityByRef.keys()),
    }),
  ];
  const builtinEntries = entries.filter(
    (entry) => entry.targetKind === "builtin"
  );

  return {
    detectedNotSupportedYet: builtinEntries.filter(
      (entry) =>
        entry.detected &&
        entry.launchStatus === "not_available" &&
        entry.selectableReason === "not_supported_yet"
    ).length,
    detectedSupported: builtinEntries.filter(
      (entry) => entry.detected && entry.launchStatus === "ready"
    ).length,
    entries,
    needsChoice: builtinEntries.filter(
      (entry) => entry.detected && entry.launchStatus === "needs_choice"
    ).length,
    needsRepair: builtinEntries.filter(
      (entry) => entry.detected && entry.launchStatus === "needs_repair"
    ).length,
    notDetected: builtinEntries.filter((entry) => !entry.detected).length,
    totalBuiltins: builtinEntries.length,
  };
}

function projectBuiltinLocalAgentCatalogEntry(input: {
  capability: LocalAgentCatalogCapability | null;
  definition: BuiltinLocalAgentCatalogDefinition;
}): LocalAgentCatalogEntryProjection {
  const status = input.capability?.status ?? "unknown";
  const enabled = input.capability?.enabled ?? true;
  if (input.capability && !input.definition.runtimeSupported) {
    return {
      agentId: input.definition.agentId,
      detected: true,
      displayName: input.definition.displayName,
      enabled: false,
      lifecycleStatus: input.definition.lifecycleStatus,
      launchStatus: "not_available",
      selectable: false,
      selectableReason: "not_supported_yet",
      targetKind: "builtin",
    };
  }
  if (input.capability && !enabled) {
    return {
      agentId: input.definition.agentId,
      detected: true,
      displayName: input.definition.displayName,
      enabled: false,
      lifecycleStatus: input.definition.lifecycleStatus,
      launchStatus: "ready",
      selectable: true,
      selectableReason: null,
      targetKind: "builtin",
    };
  }
  if (status === "ready") {
    return {
      agentId: input.definition.agentId,
      detected: true,
      displayName: input.definition.displayName,
      enabled,
      lifecycleStatus: input.definition.lifecycleStatus,
      launchStatus: "ready",
      selectable: true,
      selectableReason: null,
      targetKind: "builtin",
    };
  }
  if (hasNonLaunchControllerBlocker(input.capability?.reasonCodes)) {
    return {
      agentId: input.definition.agentId,
      detected: true,
      displayName: input.definition.displayName,
      enabled,
      lifecycleStatus: input.definition.lifecycleStatus,
      launchStatus: "ready",
      selectable: true,
      selectableReason: null,
      targetKind: "builtin",
    };
  }
  // An expired report is missing evidence, not a failed launch. Only a launch
  // blocker that the last report actually carried may keep it in repair; the
  // execution target stays stale, so Wakeability still fails closed.
  if (
    status === "not_ready" ||
    (status === "stale" &&
      hasLaunchBlockerReasonCode(input.capability?.reasonCodes))
  ) {
    return {
      agentId: input.definition.agentId,
      detected: true,
      displayName: input.definition.displayName,
      enabled,
      lifecycleStatus: input.definition.lifecycleStatus,
      launchStatus: "needs_repair",
      selectable: true,
      selectableReason: null,
      targetKind: "builtin",
    };
  }
  if (status === "stale") {
    return {
      agentId: input.definition.agentId,
      detected: true,
      displayName: input.definition.displayName,
      enabled,
      lifecycleStatus: input.definition.lifecycleStatus,
      launchStatus: "ready",
      selectable: true,
      selectableReason: null,
      targetKind: "builtin",
    };
  }
  return {
    agentId: input.definition.agentId,
    detected: false,
    displayName: input.definition.displayName,
    enabled: false,
    lifecycleStatus: input.definition.lifecycleStatus,
    launchStatus: "not_available",
    selectable: false,
    selectableReason: "not_detected",
    targetKind: "builtin",
  };
}

function hasNonLaunchControllerBlocker(
  reasonCodes: readonly string[] | undefined
): boolean {
  return Boolean(
    reasonCodes?.some(
      (reasonCode) =>
        reasonCode === "controller.interface.check_failed" ||
        reasonCode === "controller.auth.unauthenticated" ||
        reasonCode.startsWith("provider_account.")
    )
  );
}

function hasLaunchBlockerReasonCode(
  reasonCodes: readonly string[] | undefined
): boolean {
  return Boolean(
    reasonCodes?.some(
      (reasonCode) =>
        reasonCode.startsWith("controller.launch.") ||
        reasonCode.startsWith("local_agent_preparation.")
    )
  );
}

function projectCustomLocalAgentCatalogEntries(input: {
  capabilities: readonly LocalAgentCatalogCapability[];
  knownAgentControllerRefs: ReadonlySet<string>;
}): LocalAgentCatalogEntryProjection[] {
  return input.capabilities.flatMap((capability) => {
    const parsed = parseAgentControllerRef(capability.agentControllerRef);
    if (!(parsed && parsed.kind === "custom")) {
      return [];
    }
    if (!input.knownAgentControllerRefs.has(parsed.ref)) {
      return [];
    }
    if (capability.status === "ready") {
      const entry: LocalAgentCatalogEntryProjection = {
        agentId: parsed.id,
        detected: true,
        displayName: formatFallbackAgentDisplayName(parsed.id),
        enabled: true,
        lifecycleStatus: "active",
        launchStatus: "ready",
        selectable: true,
        selectableReason: null,
        targetKind: "custom",
      };
      return [entry];
    }
    const entry: LocalAgentCatalogEntryProjection = {
      agentId: parsed.id,
      detected: capability.status !== "unknown",
      displayName: formatFallbackAgentDisplayName(parsed.id),
      enabled: false,
      lifecycleStatus: "active",
      launchStatus: "not_available",
      selectable: false,
      selectableReason: "custom_coming_soon",
      targetKind: "custom",
    };
    return [entry];
  });
}

function readBuiltinLocalAgentCatalogDefinitions(): readonly BuiltinLocalAgentCatalogDefinition[] {
  const document = agentsRegistryDocument as RegistryDocumentLike;
  if (!Array.isArray(document.agents)) {
    return [];
  }

  return document.agents
    .flatMap((agent): BuiltinLocalAgentCatalogDefinition[] => {
      if (!isBuiltinLocalAgentDefinition(agent)) {
        return [];
      }
      return [
        {
          agentId: agent.id,
          displayName: agent.displayName,
          lifecycleStatus: readRegistryLifecycleStatus(agent.lifecycle),
          runtimeSupported: isRegistryRuntimeSupported(agent.runtime),
        },
      ];
    })
    .sort(compareBuiltinLocalAgentDisplayNames);
}

function compareBuiltinLocalAgentDisplayNames(
  left: BuiltinLocalAgentCatalogDefinition,
  right: BuiltinLocalAgentCatalogDefinition
): number {
  const leftName = left.displayName.toLowerCase();
  const rightName = right.displayName.toLowerCase();
  if (leftName < rightName) {
    return -1;
  }
  if (leftName > rightName) {
    return 1;
  }
  if (left.displayName < right.displayName) {
    return -1;
  }
  if (left.displayName > right.displayName) {
    return 1;
  }
  return 0;
}

function isBuiltinLocalAgentDefinition(
  value: unknown
): value is RegistryAgentLike & { displayName: string; id: string } {
  if (!isRegistryAgentLike(value)) {
    return false;
  }
  if (value.category !== "builtin") {
    return false;
  }
  if (!(isNonEmptyString(value.id) && isNonEmptyString(value.displayName))) {
    return false;
  }
  return true;
}

function isRegistryAgentLike(value: unknown): value is RegistryAgentLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRegistryRuntimeSupported(value: unknown): boolean {
  if (!(typeof value === "object" && value !== null && !Array.isArray(value))) {
    return false;
  }
  return (value as RegistryRuntimeLike).supported === true;
}

function readRegistryLifecycleStatus(value: unknown): "active" | "suspended" {
  if (!(typeof value === "object" && value !== null && !Array.isArray(value))) {
    return "active";
  }
  const status = (value as RegistryLifecycleLike).status;
  if (status === "active" || status === "suspended") {
    return status;
  }
  throw new Error(
    `Invalid agents registry lifecycle status: ${String(status)}`
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatFallbackAgentDisplayName(agentId: string): string {
  return agentId
    .split(AGENT_ID_WORD_SEPARATOR_RE)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
