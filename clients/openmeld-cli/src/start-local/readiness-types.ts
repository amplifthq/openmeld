import type { StartDeviceProjection } from "@openmeld/schemas/types";
import type { AgentTargetSelectableReason } from "../agents/registry";
import type { CommandAuthenticationStatus } from "../auth/command-auth";
import type { DaemonServiceRuntimeStatus } from "../config/daemon-state";

export type StartReadinessSnapshot = {
  auth: {
    status: CommandAuthenticationStatus;
    email: string | null;
    authBaseUrl: string | null;
    gatewayUrl: string;
  };
  skills: {
    status: "up_to_date" | "action_required" | "no_targets" | "unknown";
    targetCount: number;
    summary: {
      upToDate: number;
      outdated: number;
      missing: number;
      externalConflict: number;
    };
    error?: string;
  };
  agents: {
    status: "ok" | "unknown";
    totalBuiltins: number;
    detectedSupported: number;
    needsChoice: number;
    needsRepair: number;
    detectedNotSupportedYet: number;
    notDetected: number;
    candidates: Array<{
      agentId: string;
      displayName: string;
      detected: boolean;
      enabled: boolean;
      lifecycleStatus: "active" | "suspended";
      selectable: boolean;
      selectableReason: AgentTargetSelectableReason | null;
      launchStatus: "ready" | "needs_choice" | "needs_repair" | "not_available";
    }>;
    error?: string;
  };
  service: {
    status:
      | "installed_current"
      | "installed_outdated"
      | "not_installed"
      | "unknown";
    installedVersion: string | null;
    expectedVersion: string;
    executionCompatibility?: StartDeviceProjection["backgroundHelper"]["executionCompatibility"];
    runtime?: DaemonServiceRuntimeStatus | null;
    error?: string;
  };
};
