// Maintenance must remain loadable when the business command graph cannot start.
// Both distributions use this entry; normal commands keep their existing parser.
const args = process.argv.slice(2);

if (args.length === 2 && args[0] === "service" && args[1] === "update-worker") {
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
    console.error("[openmeld.maintenance.upgrade_failed]", error);
    process.exitCode = 1;
  }
} else {
  await import("./openmeld");
}
