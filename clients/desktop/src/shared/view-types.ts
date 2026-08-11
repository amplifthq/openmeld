// The Desktop GUI's own minimal view contract. L2 (state model) maps the CLI
// `--json` results (shared/types.ts) into these; L3 (renderer) consumes them.
// Deliberately small: the GUI Phase-1 surface only needs coarse service
// lifecycle + the agent catalog/enabled set + controller snapshots, not the
// CLI's full status payload.

import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import type { CliFailureKind } from "./types";

/** Coarse service lifecycle the GUI renders. `unknown` = not determinable. */
export type ServiceLifecycle =
  | "running"
  | "stopped"
  | "not_installed"
  | "unknown";

/** A normalized CLI failure, suitable for surfacing in the GUI. */
export type CliProblem = {
  kind: CliFailureKind;
  /** The CLI/synthetic error code (always present). */
  code: string;
  message: string;
  requestId: string | null;
};

export type CliVersionView = {
  currentVersion: string | null;
  latestVersion: string | null;
  requiredVersion: string | null;
  updateAvailable: boolean | null;
  checked: boolean;
};

export type ServiceAttentionView = {
  code: string;
  level: string | null;
  message: string | null;
  nextStep: string | null;
  anomalyCodes: string[];
};

export type ServiceSetupGuidanceView = {
  autoStartDescription: string;
  disableAutoStartCommand: string;
  statusDescription: string;
  stopCommand: string;
  stoppedLocalAgentsDescription: string;
};

export type ServiceView = {
  lifecycle: ServiceLifecycle;
  /** OpenMeld-recorded daemon install state; null when not determinable. */
  installed: boolean | null;
  /** OS-service running state (launchd/systemd); null when not determinable. */
  running: boolean | null;
  /** OS-service manager autostart state; null when not determinable. */
  autoStart: boolean | null;
  /** OpenMeld CLI version projection from the CLI status surface. */
  cliVersion: CliVersionView | null;
  /** Raw runtime/update projection passthrough; shape refined at wiring (L4). */
  runtimeProjection: unknown;
  /** CLI-provided local service attention projection, when present. */
  attention?: ServiceAttentionView | null;
  /** Setup-specific service guidance from the CLI setup.complete payload. */
  setupGuidance?: ServiceSetupGuidanceView | null;
  /** Set when the `service status` command itself failed. */
  problem: CliProblem | null;
};

export type ServiceAutoStartUpdateView = {
  service: ServiceView;
  /** Set when the autostart write failed; service status remains separate. */
  problem: CliProblem | null;
};

export type AgentView = {
  id: string;
  displayName: string;
  /** Detected on this computer (from `agents detect`). */
  detected: boolean;
  lifecycleStatus: "active" | "suspended";
  /** Eligible to be enabled (no blockers). */
  selectable: boolean;
  /** Enabled in the runtime registry (from `agents list`); null if unknown. */
  enabled: boolean | null;
  /** Why the agent is not selectable, if applicable. */
  blockerReasonCodes: string[];
  launchStatus: string | null;
  agentControllerInterface: AgentControllerInterfaceSnapshot | null;
};

export type AgentsView = {
  agents: AgentView[];
  /** Set when a contributing command (detect/list) failed. */
  problem: CliProblem | null;
};

/** Whether the OpenMeld account is signed in on this machine. `null` = unknown. */
export type AuthView = {
  signedIn: boolean | null;
  /** Account email when signed in, for display. */
  email: string | null;
  /** Set when the auth read itself failed. */
  problem: CliProblem | null;
};

export type AuthLogoutView = {
  /** What the local logout command reported about the local CLI session. */
  localSession: "cleared" | "none" | "unknown";
  /** Best-effort local cleanup can warn while the auth reread remains useful. */
  cleanup: {
    status: "finished" | "warning" | "unknown";
    message: string | null;
  };
  /** Set when the logout command itself could not run or reported no signal. */
  problem: CliProblem | null;
};

export type AuthSignOutView = {
  /** Reread after local sign-out finishes. */
  auth: AuthView;
  /** Reread after local sign-out cleanup may have stopped the service. */
  service: ServiceView;
  logout: AuthLogoutView;
};

export type DesktopSettingsProblem = {
  code: string;
  message: string;
};

export type DesktopSettingsView = {
  /** Whether the Desktop tray app opens at user login. */
  openAtLogin: boolean | null;
  /** Set when Electron cannot read or update Desktop app preferences. */
  problem: DesktopSettingsProblem | null;
};

export type DesktopUpdateProblem = {
  code: string;
  message: string;
};

export type DesktopMacArtifactView = {
  url: string;
  version: string;
  sha256: string | null;
  sizeBytes: number | null;
};

export type DesktopUpdateView = {
  status: "idle" | "available" | "required";
  checked: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  minimumSupportedVersion: string | null;
  downloadPageUrl: string;
  message: string | null;
  macosArm64: DesktopMacArtifactView | null;
  problem: DesktopUpdateProblem | null;
};
