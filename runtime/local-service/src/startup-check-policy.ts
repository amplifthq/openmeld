import { resolveStartupCommandCapability } from "./startup-command-capability.js";

export function shouldSkipDaemonStartupCheck(command: string | null): boolean {
  return resolveStartupCommandCapability(command).skipDaemonStartupCheck;
}

export function shouldSkipStartupUpgradeCheck(command: string | null): boolean {
  return resolveStartupCommandCapability(command).skipStartupUpgradeCheck;
}

export function shouldSkipDevAutoStartGuard(command: string | null): boolean {
  return resolveStartupCommandCapability(command).skipDevAutoStartGuard;
}
