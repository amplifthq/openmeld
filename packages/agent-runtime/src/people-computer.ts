import type {
  DaemonServiceLane,
  LocalRuntimesResponse,
  PeopleComputersResponse,
  PeopleComputerTarget,
} from "@openmeld/schemas/types";

// Compatibility projection for consumers of the legacy local-agent inventory.
// The caller supplies its selected target: CLI device proof or Web routing
// preference. These flags never establish physical identity or connection.
export function projectPeopleComputersToLegacyLocalRuntimes(
  inventory: PeopleComputersResponse,
  target: PeopleComputerTarget | null
): LocalRuntimesResponse {
  return {
    currentDeviceId: target?.deviceId ?? null,
    currentRuntimeLane: target?.runtimeLane ?? null,
    localRuntimes: inventory.computers.map(
      ({
        identityStatus: _identity,
        connection: _connection,
        ...computer
      }) => ({
        ...computer,
        isCurrent:
          target !== null &&
          peopleComputerContainsDevice(computer, target.deviceId),
        executionTargets: computer.executionTargets.map((entry) => ({
          ...entry,
          isCurrent:
            entry.deviceId === target?.deviceId &&
            entry.runtimeLane === target?.runtimeLane,
        })),
      })
    ),
  };
}

export function peopleComputerContainsDevice(
  computer: {
    deviceId: string;
    legacyDeviceIds?: readonly string[];
    executionTargets: readonly { deviceId: string }[];
  },
  deviceId: string
): boolean {
  return (
    computer.deviceId === deviceId ||
    computer.legacyDeviceIds?.includes(deviceId) === true ||
    computer.executionTargets.some((target) => target.deviceId === deviceId)
  );
}

export function peopleComputerCliCommand(
  lane: DaemonServiceLane
): "openmeld" | "openmeld-dev" | "openmeld-canary" {
  switch (lane) {
    case "prod":
      return "openmeld";
    case "dev-local":
      return "openmeld-dev";
    case "canary":
      return "openmeld-canary";
    default:
      throw new Error(`Unsupported computer runtime lane: ${String(lane)}`);
  }
}
