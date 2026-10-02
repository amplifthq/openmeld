import { AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION } from "@openmeld/agent-runtime";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";

export function projectAgentControllerInterfaceForCloud(
  snapshot: AgentControllerInterfaceSnapshot
): AgentControllerInterfaceSnapshot {
  return {
    agentControllerRef: snapshot.agentControllerRef,
    auth: {
      ...(snapshot.auth.email ? { email: snapshot.auth.email } : {}),
      ...(snapshot.auth.label ? { label: snapshot.auth.label } : {}),
      status: snapshot.auth.status,
      ...(snapshot.auth.type ? { type: snapshot.auth.type } : {}),
    },
    capabilities: {
      approvals: snapshot.capabilities.approvals,
      cancel: snapshot.capabilities.cancel,
      interrupt: snapshot.capabilities.interrupt,
      modelSelection: snapshot.capabilities.modelSelection,
      nativeEventStream: snapshot.capabilities.nativeEventStream,
      permissionModes: snapshot.capabilities.permissionModes,
      structuredUserInput: snapshot.capabilities.structuredUserInput,
    },
    ...(snapshot.check
      ? {
          check: snapshot.check,
        }
      : {}),
    checkedAt: snapshot.checkedAt,
    controllerId: snapshot.controllerId,
    displayName: snapshot.displayName,
    launch: {
      argsPrefix: [],
      commandPath: null,
      installChoiceCount: snapshot.launch.installChoiceCount,
      status: snapshot.launch.status,
      ...(snapshot.launch.failureReason
        ? { failureReason: snapshot.launch.failureReason }
        : {}),
    },
    message: null,
    models: snapshot.models.map((model) => ({ ...model })),
    nativeInterface: snapshot.nativeInterface,
    schemaVersion: snapshot.schemaVersion,
    skills: [],
    status: snapshot.status,
    ...(snapshot.usageLimits
      ? {
          usageLimits: snapshot.usageLimits.map((limit) => ({
            key: limit.key,
            label: limit.label,
            observedAt: limit.observedAt,
            ...(limit.reason ? { reason: limit.reason } : {}),
            ...(limit.provider
              ? {
                  provider: {
                    displayName: limit.provider.displayName,
                    id: limit.provider.id,
                  },
                }
              : {}),
            resetsAt: limit.resetsAt,
            status: limit.status,
            usedPercent: limit.usedPercent,
          })),
        }
      : {}),
    usageLimitsSupportMatrixVersion:
      AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
    version: snapshot.version,
    ...(snapshot.versionAdvisory
      ? {
          versionAdvisory: {
            checkedAt: snapshot.versionAdvisory.checkedAt,
            currentVersion: snapshot.versionAdvisory.currentVersion,
            latestVersion: snapshot.versionAdvisory.latestVersion,
            message: null,
            status: snapshot.versionAdvisory.status,
            updateCommand: snapshot.versionAdvisory.updateCommand,
          },
        }
      : {}),
  };
}
