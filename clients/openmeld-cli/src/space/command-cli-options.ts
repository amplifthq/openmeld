import type { Command } from "commander";

type SpaceCommandCliOptions = {
  gatewayUrl?: string;
  profile?: string;
  password?: string;
  json?: boolean;
};

export function resolveSpaceCommandCliOptions(
  command: Command,
  options?: {
    profile?: unknown;
    password?: unknown;
    json?: unknown;
  }
): SpaceCommandCliOptions {
  const inheritedOptions = resolveInheritedSpaceCommandCliOptions(command);
  const currentOptions = command.optsWithGlobals() as {
    gatewayUrl?: unknown;
    profile?: unknown;
    password?: unknown;
    json?: unknown;
  };
  const localProfile =
    typeof options?.profile === "string" ? options.profile : undefined;
  const localPassword =
    typeof options?.password === "string" ? options.password : undefined;
  const localJson = options?.json === true;

  return {
    ...inheritedOptions,
    ...(typeof currentOptions.gatewayUrl === "string"
      ? { gatewayUrl: currentOptions.gatewayUrl }
      : {}),
    ...(typeof currentOptions.profile === "string"
      ? { profile: currentOptions.profile }
      : {}),
    ...(typeof currentOptions.password === "string"
      ? { password: currentOptions.password }
      : {}),
    ...(currentOptions.json === true ? { json: true } : {}),
    ...(localProfile ? { profile: localProfile } : {}),
    ...(localPassword ? { password: localPassword } : {}),
    ...(localJson ? { json: true } : {}),
  };
}

function resolveInheritedSpaceCommandCliOptions(
  command: Command
): SpaceCommandCliOptions {
  const resolved: SpaceCommandCliOptions = {};

  for (let current = command.parent; current; current = current.parent) {
    const parentOptions = current.opts() as {
      gatewayUrl?: unknown;
      profile?: unknown;
      password?: unknown;
      json?: unknown;
    };

    if (
      resolved.gatewayUrl === undefined &&
      typeof parentOptions.gatewayUrl === "string"
    ) {
      resolved.gatewayUrl = parentOptions.gatewayUrl;
    }
    if (
      resolved.profile === undefined &&
      typeof parentOptions.profile === "string"
    ) {
      resolved.profile = parentOptions.profile;
    }
    if (
      resolved.password === undefined &&
      typeof parentOptions.password === "string"
    ) {
      resolved.password = parentOptions.password;
    }
    if (resolved.json === undefined && parentOptions.json === true) {
      resolved.json = true;
    }
  }

  return resolved;
}
