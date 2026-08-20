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
    },
    message: null,
    models: [],
    nativeInterface: snapshot.nativeInterface,
    schemaVersion: snapshot.schemaVersion,
    skills: [],
    status: snapshot.status,
    ...(snapshot.usageLimits ? { usageLimits: snapshot.usageLimits } : {}),
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
