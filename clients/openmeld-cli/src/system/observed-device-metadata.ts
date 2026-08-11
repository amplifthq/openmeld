import { execFile as execFileCallback } from "node:child_process";
import { hostname, release } from "node:os";
import { promisify } from "node:util";
import type { ObservedDeviceMetadata } from "@openmeld/schemas/types";

const execFile = promisify(execFileCallback);
const MACBOOK_DISPLAY_NAME_PATTERN = /MacBook/i;
const DESKTOP_MAC_DISPLAY_NAME_PATTERN = /iMac|Mac mini|Mac Studio|Mac Pro/i;

export async function collectObservedDeviceMetadata(input?: {
  now?: Date;
}): Promise<ObservedDeviceMetadata> {
  const observedDisplayName = await resolveObservedDeviceDisplayName();

  return {
    observedDisplayName,
    platformFamily: resolveObservedPlatformFamily(process.platform),
    osVersion: normalizeOptionalText(release()),
    deviceType: resolveObservedDeviceType({
      platform: process.platform,
      observedDisplayName,
    }),
    observedAtMs: (input?.now ?? new Date()).getTime(),
  };
}

async function resolveObservedDeviceDisplayName(): Promise<string | null> {
  if (process.platform === "darwin") {
    const computerName = await readMacComputerName();
    if (computerName) {
      return computerName;
    }
  }

  if (process.platform === "win32") {
    return (
      normalizeOptionalText(process.env.COMPUTERNAME) ??
      normalizeOptionalText(hostname())
    );
  }

  return normalizeOptionalText(hostname());
}

async function readMacComputerName(): Promise<string | null> {
  try {
    const result = await execFile("scutil", ["--get", "ComputerName"]);
    return normalizeOptionalText(result.stdout);
  } catch {
    return normalizeOptionalText(hostname());
  }
}

function resolveObservedPlatformFamily(
  platform: NodeJS.Platform
): ObservedDeviceMetadata["platformFamily"] {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return "Unknown";
  }
}

function resolveObservedDeviceType(input: {
  platform: NodeJS.Platform;
  observedDisplayName: string | null;
}): ObservedDeviceMetadata["deviceType"] {
  if (input.platform !== "darwin") {
    return "unknown";
  }

  if (input.observedDisplayName?.match(MACBOOK_DISPLAY_NAME_PATTERN)) {
    return "laptop";
  }

  if (input.observedDisplayName?.match(DESKTOP_MAC_DISPLAY_NAME_PATTERN)) {
    return "desktop";
  }

  return "unknown";
}

function normalizeOptionalText(
  input: string | null | undefined
): string | null {
  const normalized = input?.trim();
  return normalized ? normalized : null;
}
