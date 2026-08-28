import type {
  AdapterInterruptMode,
  AdapterInterruptSignal,
  AgentControllerProcessSignalTarget,
} from "@openmeld/adapter-core";
import type {
  AgentControllerPermissionMode,
  OpenMeldDaemonControlPlaneRequest,
  OpenMeldDaemonControlPlaneResponse,
  OpenMeldDaemonControlTargetSelector,
} from "@openmeld/schemas/types";

export type InflightTaskControlRecord = {
  adapterId: string;
  agentControllerPermissionMode: AgentControllerPermissionMode | null;
  dispatchId: string;
  processId: number | null;
  runtimeCoordinatorExecutionId: string | null;
  signalTarget: AgentControllerProcessSignalTarget | null;
  targetProfileId: string | null;
  taskId: string;
  updatedAt: string;
};

export type ControlSignalResult = {
  dispatchId: string;
  processId: number;
  signalTarget: AgentControllerProcessSignalTarget;
  taskId: string;
  unixSignal: NodeJS.Signals;
};

export type LocalTaskInterruptSender = (
  signal: AdapterInterruptSignal
) => Promise<ControlSignalResult>;

export type LocalTaskInterruptErrorCode =
  | "signal.send_failed"
  | "task.not_found"
  | "task.not_running";

export type LocalControlCommandName = Extract<
  OpenMeldDaemonControlPlaneRequest["command"],
  "cancel" | "interrupt"
>;

export type LocalControlAcceptedResponse = Extract<
  OpenMeldDaemonControlPlaneResponse,
  { code: "service.cancel" | "service.interrupt" }
>;

export type LocalControlPlaneRequest = Extract<
  OpenMeldDaemonControlPlaneRequest,
  { command: "cancel" | "interrupt" }
>;

export type LocalControlTargetSelector = OpenMeldDaemonControlTargetSelector;

export type LocalControlResolution = {
  record: InflightTaskControlRecord;
  target: OpenMeldDaemonControlTargetSelector;
};

export type LocalControlRequestHandler = (
  request: OpenMeldDaemonControlPlaneRequest
) => Promise<OpenMeldDaemonControlPlaneResponse>;

export const resolveUnixSignalForInterruptMode = (
  mode: AdapterInterruptMode
): NodeJS.Signals => (mode === "force" ? "SIGKILL" : "SIGTERM");
