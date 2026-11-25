import type { DesktopLocalComputer } from "@openmeld/schemas";
import { type CommandDeps, serviceStatus } from "./cli/commands";
import { resolveOpenMeldBin } from "./cli/resolve-openmeld";
import {
  isComputerConnectionBootstrapError,
  readComputerConnection,
} from "./computer-connection";
import type { PilotAuth } from "./pilot-auth";
import { toServiceView } from "./state/view-state";

// Used only after the existing cloud observation says the local Computer is
// disconnected. A missing heartbeat alone never establishes an auth failure.
export function createLocalServiceAuthenticationReader(
  auth: Pick<PilotAuth, "session">,
  deps: CommandDeps
) {
  return async (expectedAccount: string): Promise<boolean> => {
    if (
      !hasLocalComputerEnvironment(deps) ||
      (await auth.session()).user?.id !== expectedAccount
    ) {
      return false;
    }
    const review = await readComputerConnection(
      resolveOpenMeldBin({ env: deps.env, override: deps.openMeldBin }),
      deps
    );
    if (review.account?.id !== expectedAccount) {
      return false;
    }
    const service = toServiceView(await serviceStatus(deps));
    return (
      (await auth.session()).user?.id === expectedAccount &&
      service.running === true &&
      !service.problem &&
      service.attention?.code === "authentication_required"
    );
  };
}

function hasLocalComputerEnvironment(deps: CommandDeps): boolean {
  return (
    deps.env?.OPENMELD_ENV_PRESET === "prod" ||
    Boolean(
      deps.env?.OPENMELD_HOME &&
        deps.env.OPENMELD_AUTH_URL &&
        deps.env.OPENMELD_GATEWAY_URL
    )
  );
}

// Read the CLI's public identity projection. This never installs or starts a Service.
export function createLocalComputerReader(
  auth: Pick<PilotAuth, "session">,
  deps: CommandDeps
) {
  return async (): Promise<DesktopLocalComputer> => {
    try {
      if (!hasLocalComputerEnvironment(deps)) {
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
        deps,
        { includeStopped: true }
      ).catch((error: unknown) => {
        if (!isComputerConnectionBootstrapError(error)) {
          throw error;
        }
        return null;
      });
      const after = await auth.session();
      if (after.user?.id !== before.user.id) {
        throw new Error("Desktop sign-in changed during the connection check.");
      }
      if (!review) {
        // A bootstrap entry, not a confirmed Computer identity. Reading never
        // installs; explicit Connect rechecks the account, verifies installation
        // and rereads the CLI-owned connection review.
        return {
          status: "unavailable",
          message:
            "OpenMeld Tools are missing or need an update. Connect this Mac to install them and continue.",
        };
      }
      return projectLocalComputer(review, before.user.id);
    } catch (error) {
      // Retain bounded native diagnostics without logging CLI output or private paths.
      console.warn("[desktop.computer_check_failed]", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        code: (error as { code?: string | number })?.code ?? null,
      });
      return {
        status: "unavailable",
        message:
          "Couldn’t check this Mac’s connection. Check its OpenMeld Service and try again.",
      };
    }
  };
}

function projectLocalComputer(
  review: Awaited<ReturnType<typeof readComputerConnection>>,
  accountId: string
): DesktopLocalComputer {
  if (review.account && review.account.id !== accountId) {
    return {
      status: "unavailable",
      message:
        "This Mac is connected to a different account. Connect it to your Desktop account.",
    };
  }
  if (!(review.account && review.existingConnection)) {
    return {
      status: "unavailable",
      message: "Use local agents in OpenMeld, even after you quit Desktop.",
    };
  }
  return {
    status: "available",
    accountId,
    target: review.existingConnection,
  };
}
