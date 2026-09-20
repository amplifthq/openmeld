import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";

// biome-ignore lint/performance/noBarrelFile: agent-runtime re-exports the shared hosted ref constants as part of its public ref helpers.
export {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";

export type AgentControllerRefKind =
  | "builtin"
  | "custom"
  | "hosted:center-agent"
  | "hosted:remote-agent";

export type AgentControllerRef = {
  kind: AgentControllerRefKind;
  id: string;
  ref: string;
};

export type RuntimeAgentTargetKind = AgentControllerRefKind;

export type RuntimeAdapterCapabilityIdentity = {
  adapterId: string | null | undefined;
};

const AGENT_CONTROLLER_REF_SEPARATOR = ":";
const SUPPORTED_AGENT_CONTROLLER_REF_KINDS: readonly AgentControllerRefKind[] =
  ["builtin", "custom", HOSTED_CENTER_AGENT_CONTROLLER_REF];
const AGENT_CONTROLLER_SOURCE_ID_RE = /^[a-zA-Z0-9_.-]+$/;

const normalizeCapabilitySourceId = (input: {
  kind: AgentControllerRefKind;
  id: string;
}): string => {
  if (input.kind === HOSTED_REMOTE_AGENT_CONTROLLER_REF) {
    if (input.id.trim() !== "remote-agent") {
      throw new Error(
        "runtime.agent_controller_ref_invalid: hosted Remote Agent id must be remote-agent"
      );
    }
    return "remote-agent";
  }
  if (input.kind === HOSTED_CENTER_AGENT_CONTROLLER_REF) {
    if (input.id.trim() !== HOSTED_CENTER_AGENT_CONTROLLER_REF_ID) {
      throw new Error(
        "runtime.agent_controller_ref_invalid: hosted Center Agent id must be center-agent"
      );
    }
    return HOSTED_CENTER_AGENT_CONTROLLER_REF_ID;
  }
  const prefix = `${input.kind}${AGENT_CONTROLLER_REF_SEPARATOR}`;
  const rawId = input.id.trim();
  const id = rawId.startsWith(prefix)
    ? rawId.slice(prefix.length).trim()
    : rawId;
  if (!(id && AGENT_CONTROLLER_SOURCE_ID_RE.test(id))) {
    throw new Error(
      `runtime.agent_controller_ref_invalid: invalid ${input.kind} capability id`
    );
  }
  return id;
};

export const buildAgentControllerRef = (input: {
  kind: AgentControllerRefKind;
  id: string;
}): string => {
  const id = normalizeCapabilitySourceId(input);
  if (input.kind === HOSTED_REMOTE_AGENT_CONTROLLER_REF) {
    return HOSTED_REMOTE_AGENT_CONTROLLER_REF;
  }
  if (input.kind === HOSTED_CENTER_AGENT_CONTROLLER_REF) {
    return HOSTED_CENTER_AGENT_CONTROLLER_REF;
  }
  return `${input.kind}${AGENT_CONTROLLER_REF_SEPARATOR}${id}`;
};

export const parseAgentControllerRef = (
  value: string | null | undefined
): AgentControllerRef | null => {
  const ref = String(value ?? "").trim();
  if (!ref) {
    return null;
  }
  if (ref === HOSTED_REMOTE_AGENT_CONTROLLER_REF) {
    return {
      kind: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
      id: "remote-agent",
      ref,
    };
  }
  if (ref === HOSTED_CENTER_AGENT_CONTROLLER_REF) {
    return {
      kind: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      id: HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
      ref: HOSTED_CENTER_AGENT_CONTROLLER_REF,
    };
  }
  for (const kind of SUPPORTED_AGENT_CONTROLLER_REF_KINDS) {
    if (kind === HOSTED_CENTER_AGENT_CONTROLLER_REF) {
      continue;
    }
    const prefix = `${kind}${AGENT_CONTROLLER_REF_SEPARATOR}`;
    if (!ref.startsWith(prefix)) {
      continue;
    }
    const id = ref.slice(prefix.length).trim();
    if (!(id && AGENT_CONTROLLER_SOURCE_ID_RE.test(id))) {
      return null;
    }
    return {
      kind,
      id,
      ref: `${kind}${AGENT_CONTROLLER_REF_SEPARATOR}${id}`,
    };
  }
  return null;
};

export const resolveAgentControllerRefFromAgentTarget = (input: {
  targetKind: RuntimeAgentTargetKind;
  agentId: string;
}): string => {
  return buildAgentControllerRef({
    kind: input.targetKind,
    id: input.agentId,
  });
};

export const runtimeAgentControllerRefMatchesAdapterSnapshot = (input: {
  adapter: RuntimeAdapterCapabilityIdentity;
  agentControllerRef: string | null | undefined;
}): boolean => {
  const agentControllerRef = parseAgentControllerRef(input.agentControllerRef);
  if (!agentControllerRef) {
    return false;
  }
  if (
    agentControllerRef.kind === HOSTED_CENTER_AGENT_CONTROLLER_REF ||
    agentControllerRef.kind === HOSTED_REMOTE_AGENT_CONTROLLER_REF
  ) {
    return false;
  }
  return String(input.adapter.adapterId ?? "").trim() === agentControllerRef.id;
};

export const hasRuntimeAdapterCapabilityForRef = (input: {
  agentControllerRef: string | null | undefined;
  runtimeAdapters:
    | readonly RuntimeAdapterCapabilityIdentity[]
    | null
    | undefined;
}): boolean => {
  return (input.runtimeAdapters ?? []).some((adapter) =>
    runtimeAgentControllerRefMatchesAdapterSnapshot({
      adapter,
      agentControllerRef: input.agentControllerRef,
    })
  );
};
