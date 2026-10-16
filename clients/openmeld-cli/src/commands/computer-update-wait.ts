import { waitForOpenMeldToolsUpdateCompletion } from "../local-service/maintenance/openmeld-tools-update-join";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter";
import { withSetupCommandLock } from "./setup-command-lock";
import { createSetupUpdateObserver } from "./setup-update-progress";

// Observe the existing worker before Desktop creates expiring authorization.
// This command never schedules an update or changes the current account.
export async function runComputerUpdateWait(): Promise<void> {
  const presenter = createPresenter(
    await resolveRuntimeContext({ view: "agent" })
  );
  await withSetupCommandLock({
    lockMeta: { command: "openmeld computer wait-for-update" },
    view: "agent",
    run: async () => {
      await waitForOpenMeldToolsUpdateCompletion({
        pollIntervalMs: 2000,
        onObservation: createSetupUpdateObserver(presenter),
      });
      presenter.line({
        code: "computer.update_ready",
        text: "Computer connection can continue.",
      });
    },
  });
}
