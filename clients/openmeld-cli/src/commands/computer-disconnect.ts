import {
  type ComputerConnectionIntent,
  computerConnectionIntentSchema,
  type DesktopComputerDisconnectRequest,
  desktopComputerDisconnectRequestSchema,
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
  view?: string,
  target?: DesktopComputerDisconnectRequest["expectedConnection"]
) {
  const presenter = createPresenter(await resolveRuntimeContext({ view }));
  presenter.line({
    code: "computer.disconnect.started",
    text: "Stopping OpenMeld Service…",
    data: { state: "started" },
  });
  await disconnectComputer(request, target);
  presenter.line({
    code: "computer.disconnected",
    text: "This computer is disconnected. Its record is still in your account.",
  });
}

export async function runComputerDisconnectTarget(
  request: DesktopComputerDisconnectRequest,
  view?: string
) {
  const target = desktopComputerDisconnectRequestSchema.parse(request);
  if (!target.expectedConnection) {
    throw new Error(
      "Specify the Computer device and runtime lane to disconnect."
    );
  }
  const session = await getAuthSessionMetadata();
  await runComputerDisconnect(
    {
      expectedAccount: target.expectedAccount,
      previousSessionIdentity: buildStoredAuthSessionIdentity(session),
    },
    view,
    target.expectedConnection
  );
}

// Disconnect ends this Mac's local account connection. Forget remains the
// separate cloud operation that removes the account's Computer record.
export async function disconnectComputer(
  request: ComputerConnectionIntent,
  target?: DesktopComputerDisconnectRequest["expectedConnection"]
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
    if (target || contract?.desiredState === "stopped") {
      const current = await getAuthSession();
      if (!(current && contract)) {
        throw new Error(
          "Review this computer's connection before disconnecting."
        );
      }
      const identity = await resolveServiceAccountIdentity(current, contract);
      if (
        target &&
        (identity.accountId !== intent.expectedAccount ||
          identity.deviceId !== target.deviceId ||
          identity.lane !== target.runtimeLane)
      ) {
        throw new Error(
          "This command is for a different Computer or environment. Run it on the Computer shown in OpenMeld."
        );
      }
    }
    const runtime = await readCurrentDaemonRuntimeContext();
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
