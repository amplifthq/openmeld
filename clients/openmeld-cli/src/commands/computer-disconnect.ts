import {
  type ComputerConnectionIntent,
  computerConnectionIntentSchema,
} from "@openmeld/schemas";
import {
  buildStoredAuthSessionIdentity,
  clearAuthSession,
  getAuthSession,
  getAuthSessionMetadata,
} from "../config/auth-session";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import { withDaemonServiceRunLock } from "../config/daemon-state";
import { readCurrentDaemonRuntimeContext } from "../local-service/lifecycle/daemon-service-runtime";
import { resolveServiceAccountIdentity } from "../local-service/lifecycle/service-account-authorization";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import { runServiceAccountControl } from "./service-account-control";

export async function runComputerDisconnect(
  request: ComputerConnectionIntent,
  view?: string
) {
  const presenter = createPresenter(await resolveRuntimeContext({ view }));
  presenter.line({
    code: "computer.disconnect.started",
    text: "Stopping OpenMeld Service…",
    data: { state: "started" },
  });
  await disconnectComputer(request);
  presenter.line({
    code: "computer.disconnected",
    text: "This computer is disconnected. Its record is still in your account.",
  });
}

// Disconnect ends this Mac's local account connection. Forget remains the
// separate cloud operation that removes the account's Computer record.
export async function disconnectComputer(
  request: ComputerConnectionIntent
): Promise<void> {
  const intent = computerConnectionIntentSchema.parse(request);
  const session = await getAuthSessionMetadata();
  if (
    !session ||
    session.user?.id !== intent.expectedAccount ||
    buildStoredAuthSessionIdentity(session) !== intent.previousSessionIdentity
  ) {
    throw new Error(
      "The computer sign-in changed. Review its connection before disconnecting."
    );
  }
  // The existing admission owner rechecks account, process and generation,
  // drains active work, and disables automatic startup. Never use an unscoped Stop.
  await withDaemonServiceRunLock(async () => {
    const contract = await readDaemonServiceContract();
    const runtime = await readCurrentDaemonRuntimeContext();
    if (contract?.desiredState === "stopped") {
      const current = await getAuthSession();
      if (!current) {
        throw new Error("Review this computer's sign-in before disconnecting.");
      }
      await resolveServiceAccountIdentity(current, contract);
    }
    // A retry may follow an acknowledged Stop and a failed credential cleanup.
    // Only the owner's explicit stopped intent can skip another Stop.
    if (
      !(
        contract?.ownerUserId === intent.expectedAccount &&
        contract.desiredState === "stopped" &&
        runtime.effectiveRuntimeStatus === "not_running"
      )
    ) {
      await runServiceAccountControl(
        {
          operation: "stop",
          expectedAccount: intent.expectedAccount,
        },
        intent.previousSessionIdentity
      );
    }
    // Hold the existing lifecycle lock through cleanup so Start cannot race it.
    // A concurrent sign-in after Stop must never be cleared by this operation.
    await clearAuthSession(session);
  });
}
