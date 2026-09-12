import { setTimeout as sleep } from "node:timers/promises";
import {
  hasPendingComputerSetupContinuation,
  resumeInterruptedComputerSetup,
} from "../config/auth-session";
import { mintPrepareSessionReconnectToken } from "../config/prepare-session-api";
import { createPresenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import { recoverInterruptedComputerAuthHandoff } from "./computer-auth-handoff-recovery";
import { runPrepareSessionExecutor } from "./prepare-session-executor";

const runtime: RuntimeContext = {
  interactive: false,
  resolvedView: "agent",
  viewMode: "agent",
};

// Called only by the existing OS-owned maintenance worker after its update.
// The live Terminal keeps ownership. If it exits, continue the same Core
// Prepare session using the existing auth journal, not a second setup plan.
export async function finishComputerSetupAfterBackgroundUpdate(): Promise<void> {
  while (await hasPendingComputerSetupContinuation()) {
    const resumed = await resumeInterruptedComputerSetup(
      async (continuation) => {
        const { snapshot, opaqueToken } =
          await mintPrepareSessionReconnectToken({
            baseUrl: continuation.gatewayUrl,
            prepareSessionId: continuation.prepareSessionId,
          });
        if (
          snapshot.lifecycleStatus !== "active" &&
          snapshot.lifecycleStatus !== "completed"
        ) {
          return "not_completed";
        }
        const result = await runPrepareSessionExecutor({
          gatewayUrl: continuation.gatewayUrl,
          initialSnapshot: snapshot,
          interactive: false,
          localAgentSelection: continuation.localAgentSelection,
          presenter: createPresenter(runtime),
          runtime,
          startSession: opaqueToken,
          view: "agent",
        });
        return result.status;
      }
    );
    if (!resumed) {
      await sleep(500);
    }
  }
}

// Run after the completed update has released its pending job. Account rollback
// uses the existing handoff recovery, which itself waits for active updates.
export async function recoverComputerSetupAfterBackgroundUpdate(): Promise<void> {
  await recoverInterruptedComputerAuthHandoff({
    presenter: createPresenter(runtime),
    runtime,
    view: "agent",
  });
}
