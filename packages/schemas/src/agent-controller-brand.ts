import { normalizeKnownBuiltinAgentControllerId } from "./schemas/daemon/agent-controller-ref";

export const BUILTIN_AGENT_CONTROLLER_BRAND_IDS = [
  "codex",
  "claude-code",
  "cursor",
  "grok-build",
  "opencode",
  "openclaw",
] as const;

export type BuiltinAgentControllerBrandId =
  (typeof BUILTIN_AGENT_CONTROLLER_BRAND_IDS)[number];

export type BuiltinAgentControllerBrand = {
  accentHex: string;
  accentRgb: readonly [number, number, number];
  controllerId: BuiltinAgentControllerBrandId;
  selectionMixPercent: number;
};

export const BUILTIN_AGENT_CONTROLLER_BRANDS = {
  "claude-code": {
    accentHex: "#d97757",
    accentRgb: [217, 119, 87],
    controllerId: "claude-code",
    selectionMixPercent: 34,
  },
  codex: {
    accentHex: "#869fff",
    accentRgb: [134, 159, 255],
    controllerId: "codex",
    selectionMixPercent: 36,
  },
  cursor: {
    accentHex: "#000000",
    accentRgb: [0, 0, 0],
    controllerId: "cursor",
    selectionMixPercent: 24,
  },
  "grok-build": {
    accentHex: "#1d9bf0",
    accentRgb: [29, 155, 240],
    controllerId: "grok-build",
    selectionMixPercent: 30,
  },
  opencode: {
    accentHex: "#000000",
    accentRgb: [0, 0, 0],
    controllerId: "opencode",
    selectionMixPercent: 24,
  },
  openclaw: {
    accentHex: "#d43838",
    accentRgb: [212, 56, 56],
    controllerId: "openclaw",
    selectionMixPercent: 32,
  },
} as const satisfies Record<
  BuiltinAgentControllerBrandId,
  BuiltinAgentControllerBrand
>;

export function isBuiltinAgentControllerBrandId(
  value: string
): value is BuiltinAgentControllerBrandId {
  return value in BUILTIN_AGENT_CONTROLLER_BRANDS;
}

export function resolveBuiltinAgentControllerBrand(
  agentControllerRef: string | null | undefined
): BuiltinAgentControllerBrand | null {
  if (!agentControllerRef) {
    return null;
  }

  const controllerId =
    normalizeKnownBuiltinAgentControllerId(agentControllerRef);
  if (!(controllerId && isBuiltinAgentControllerBrandId(controllerId))) {
    return null;
  }

  return BUILTIN_AGENT_CONTROLLER_BRANDS[controllerId];
}
