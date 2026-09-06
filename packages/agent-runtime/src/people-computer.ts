import type { DaemonServiceLane } from "@openmeld/schemas/types";

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
