import { waitForOpenMeldToolsUpdateCompletion } from "../local-service/maintenance/openmeld-tools-update-join";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter";
import { createSetupUpdateObserver } from "./setup-update-progress";

// Observe the existing worker before Desktop creates expiring authorization.
// This command never schedules an update or changes the current account.
export async function runComputerUpdateWait(): Promise<void> {
  const presenter = createPresenter(
    await resolveRuntimeContext({ view: "agent" })
  );
  // Observation must not reserve the mutation lock. Its own finite window
  // permits long drains without leaving a detached Desktop child forever.
  await waitForOpenMeldToolsUpdateCompletion({
    pollIntervalMs: 2000,
    timeoutMs: 30 * 60_000,
    onObservation: createSetupUpdateObserver(presenter),
  });
  presenter.line({
    code: "computer.update_ready",
    text: "Computer connection can continue.",
  });
}
