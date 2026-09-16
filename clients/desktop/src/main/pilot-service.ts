import {
  serviceAccountControlRequestSchema,
  serviceControlCapabilitiesSchema,
} from "@openmeld/schemas";
import {
  type CommandDeps,
  controlServiceForAccount,
  serviceControlCapabilities,
} from "./cli/commands";
import type { DesktopHandlers } from "./ipc-handlers";
import type { PilotAuth } from "./pilot-auth";

/** Only account-checked Start/Stop are enabled in the existing-Service pilot. */
export function createPilotServiceHandlers(
  base: DesktopHandlers,
  auth?: Pick<PilotAuth, "session">,
  commandDeps?: CommandDeps
): DesktopHandlers {
  const unavailable = () =>
    Promise.reject(
      new Error(
        "Computer changes are unavailable in this Desktop pilot. Manage this computer in OpenMeld Web."
      )
    );
  async function capabilities() {
    const result = await serviceControlCapabilities(commandDeps);
    const parsed = serviceControlCapabilitiesSchema.safeParse(
      result.ok ? result.data : null
    );
    return parsed.success
      ? parsed.data
      : { deviceId: null, start: false, stop: false };
  }
  async function status() {
    const [service, controlCapabilities] = await Promise.all([
      base.getServiceStatus(),
      capabilities(),
    ]);
    return { ...service, controlCapabilities };
  }
  let pending = false;
  async function control(
    operation: "start" | "stop",
    expectedAccount?: string
  ) {
    const input = serviceAccountControlRequestSchema.safeParse({
      operation,
      expectedAccount,
    });
    if (!(input.success && auth)) {
      throw new Error(
        "Check your Desktop sign-in before controlling this Service."
      );
    }
    if (pending) {
      throw new Error(
        "A Service action is still in progress. Check its status before trying again."
      );
    }
    pending = true;
    try {
      const session = await auth.session();
      if (session.user?.id !== input.data.expectedAccount) {
        throw new Error(
          "Desktop sign-in changed. Check the account and try again."
        );
      }
      if (!(await capabilities())[operation]) {
        throw new Error(
          "This CLI and Service do not support this action. Update OpenMeld through Web and check again."
        );
      }
      if ((await auth.session()).user?.id !== input.data.expectedAccount) {
        throw new Error(
          "Desktop sign-in changed. Check the account and try again."
        );
      }
      // Intent is immutable: the CLI owns the final account admission fence.
      const result = await controlServiceForAccount(
        operation,
        input.data.expectedAccount,
        commandDeps
      );
      const service = await status();
      return result.ok
        ? service
        : {
            ...service,
            problem: {
              kind: result.kind,
              code: result.error.code,
              message: result.error.message,
              requestId: result.error.requestId ?? null,
            },
          };
    } finally {
      pending = false;
    }
  }
  return {
    ...base,
    getServiceStatus: status,
    signIn: unavailable,
    signOutOnThisMac: unavailable,
    installCli: unavailable,
    upgradeCli: unavailable,
    setupComputer: unavailable,
    installService: unavailable,
    updateService: unavailable,
    startService: (expectedAccount) => control("start", expectedAccount),
    stopService: (expectedAccount) => control("stop", expectedAccount),
    setServiceAutoStart: unavailable,
    setAgentEnabled: unavailable,
  };
}
