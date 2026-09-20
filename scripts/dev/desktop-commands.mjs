const SELF_MANAGED = new Set([
  "desktop:dev",
  "desktop:start:dev",
  "dev:desktop",
  "desktop:canary",
  "desktop:start:canary",
  "desktop:prepare",
  "desktop:start:package",
  "desktop:doctor",
  "desktop:status",
  "desktop:stop",
  "desktop:web",
]);

/** Compatibility for old agent instructions wrapping the entire GUI in dev:run. */
export function isResourceManagedDesktopCommand(args) {
  if (!["pnpm", "pnpm.cmd"].includes(args[0])) {
    return false;
  }
  return SELF_MANAGED.has(args[1] === "run" ? args[2] : args[1]);
}
