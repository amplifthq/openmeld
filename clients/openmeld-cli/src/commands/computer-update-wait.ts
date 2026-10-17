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
  try {
    await waitForOpenMeldToolsUpdateCompletion({
      pollIntervalMs: 2000,
      timeoutMs: 30 * 60_000,
      onObservation: createSetupUpdateObserver(presenter),
    });
  } catch (error) {
    // The fast CLI entry bypasses the ordinary command error presenter.
    // Desktop needs the shared structured event, not an unparsed stack trace.
    presenter.line({
      code: "computer.update_wait.failed",
      text: error instanceof Error ? error.message : String(error),
      data: { state: "failed" },
    });
    throw error;
  }
  presenter.line({
    code: "computer.update_ready",
    text: "Computer connection can continue.",
  });
}
