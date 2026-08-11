export type StartupCommandCapability = {
  skipDaemonStartupCheck: boolean;
  skipStartupUpgradeCheck: boolean;
  skipDevAutoStartGuard: boolean;
};

const DEFAULT_STARTUP_COMMAND_CAPABILITY: StartupCommandCapability = {
  skipDaemonStartupCheck: false,
  skipStartupUpgradeCheck: false,
  skipDevAutoStartGuard: false,
};

const AUTH_SESSION_COMMAND_CAPABILITY: StartupCommandCapability = {
  skipDaemonStartupCheck: true,
  skipStartupUpgradeCheck: true,
  skipDevAutoStartGuard: false,
};

const PURE_READ_COMMANDS = [
  "adapter",
  "agents",
  "auth",
  "daemon",
  "doctor",
  "help",
  "profile",
  "profiles",
  "prompt",
  "repair",
  "uninstall",
  "reset",
  "service",
  "skills",
  "upgrade",
  "view",
  "whoami",
] as const;

const STARTUP_COMMAND_CAPABILITY_BY_COMMAND: Readonly<
  Record<string, StartupCommandCapability>
> = Object.freeze({
  login: AUTH_SESSION_COMMAND_CAPABILITY,
  logout: AUTH_SESSION_COMMAND_CAPABILITY,
  start: {
    skipDaemonStartupCheck: false,
    skipStartupUpgradeCheck: false,
    skipDevAutoStartGuard: true,
  },
  space: DEFAULT_STARTUP_COMMAND_CAPABILITY,
  ...Object.fromEntries(
    PURE_READ_COMMANDS.map((command) => [
      command,
      {
        skipDaemonStartupCheck: true,
        skipStartupUpgradeCheck: true,
        skipDevAutoStartGuard: false,
      } satisfies StartupCommandCapability,
    ])
  ),
});

export function resolveStartupCommandCapability(
  command: string | null
): StartupCommandCapability {
  if (!command) {
    return DEFAULT_STARTUP_COMMAND_CAPABILITY;
  }
  return (
    STARTUP_COMMAND_CAPABILITY_BY_COMMAND[command] ??
    DEFAULT_STARTUP_COMMAND_CAPABILITY
  );
}
