import type { DesktopLocalComputer } from "@openmeld/schemas";
import type { CommandDeps } from "./cli/commands";
import { resolveOpenMeldBin } from "./cli/resolve-openmeld";
import { readComputerConnection } from "./computer-connection";
import type { PilotAuth } from "./pilot-auth";

// Read the CLI's public identity projection. This never installs or starts a Service.
export function createLocalComputerReader(
  auth: Pick<PilotAuth, "session">,
  deps: CommandDeps
) {
  return async (): Promise<DesktopLocalComputer> => {
    try {
      if (
        deps.env?.OPENMELD_ENV_PRESET !== "prod" &&
        !(
          deps.env?.OPENMELD_HOME &&
          deps.env.OPENMELD_AUTH_URL &&
          deps.env.OPENMELD_GATEWAY_URL
        )
      ) {
        return {
          status: "unavailable",
          message:
            "This Desktop build has no configured local computer environment.",
        };
      }
      const before = await auth.session();
      if (!before.user) {
        return {
          status: "unavailable",
          message: "Sign in to Desktop to check this Mac’s connection.",
        };
      }
      const review = await readComputerConnection(
        resolveOpenMeldBin({ env: deps.env, override: deps.openMeldBin }),
        deps
      );
      const after = await auth.session();
      if (
        after.user?.id !== before.user.id ||
        review.account?.id !== before.user.id
      ) {
        return {
          status: "unavailable",
          message:
            "This Mac is connected to a different account. Connect it to your Desktop account.",
        };
      }
      if (!review.existingConnection) {
        return {
          status: "unavailable",
          message: "Use local agents in OpenMeld, even after you quit Desktop.",
        };
      }
      return {
        status: "available",
        accountId: before.user.id,
        target: review.existingConnection,
      };
    } catch (error) {
      // Retain bounded native diagnostics without logging CLI output or private paths.
      console.warn("[desktop.computer_check_failed]", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        code: (error as { code?: string | number })?.code ?? null,
      });
      throw new Error(
        "Couldn’t check this Mac’s connection. Check its OpenMeld Service and try again."
      );
    }
  };
}
