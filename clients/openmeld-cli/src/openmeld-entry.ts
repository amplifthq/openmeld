// Maintenance must remain loadable when the business command graph cannot start.
// Both distributions use this entry; normal commands keep their existing parser.
if (process.argv.includes("--openmeld-windows-task")) {
  const { initializeWindowsTaskEntry } = await import(
    "./local-service/lifecycle/windows-task-entry"
  );
  initializeWindowsTaskEntry();
}
const args = process.argv.slice(2);

if (
  args.length === 3 &&
  args[0] === "service" &&
  args[1] === "execution-host"
) {
  try {
    const { runExecutionHost } = await import(
      "./local-service/execution-host/entry"
    );
    const hostInstanceId = args[2];
    if (!hostInstanceId) {
      throw new Error("The Host incarnation is required.");
    }
    await runExecutionHost(hostInstanceId);
  } catch (error) {
    console.error("[openmeld.execution_host.failed]", error);
    process.exitCode = 1;
    if (process.connected) {
      process.disconnect();
    }
  }
} else if (
  args.length === 2 &&
  args[0] === "service" &&
  args[1] === "update-worker"
) {
  try {
    const { runOpenMeldMaintenanceWorker } = await import(
      "./local-service/maintenance/openmeld-maintenance-worker"
    );
    await runOpenMeldMaintenanceWorker();
  } catch (error) {
    console.error("[openmeld.maintenance.failed]", error);
    process.exitCode = 1;
  }
} else if (
  args.length === 1 &&
  (args[0] === "maintenance-upgrade" || args[0] === "maintenance-align-service")
) {
  try {
    const { runMaintenanceUpgrade } = await import("./commands/upgrade");
    await runMaintenanceUpgrade(args[0] === "maintenance-align-service");
  } catch (error) {
    try {
      const { emitOpenMeldToolsUpdateFailureFrame } = await import(
        "./local-service/maintenance/openmeld-tools-update-process-frame"
      );
      emitOpenMeldToolsUpdateFailureFrame(error);
    } catch {
      // The local worker log below remains the fallback when framing fails.
    }
    console.error("[openmeld.maintenance.upgrade_failed]", error);
    process.exitCode = 1;
  }
} else {
  await import("./openmeld");
}
