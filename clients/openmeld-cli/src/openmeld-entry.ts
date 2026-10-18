import { unsupportedNodeRuntimeMessage } from "@openmeld/start/node-runtime";

// Check before loading commands or native dependencies. Standalone binaries own
// their Bun runtime and do not depend on the user's Node installation.
if (!process.versions.bun) {
  const message = unsupportedNodeRuntimeMessage(process.versions.node);
  if (message) {
    // Keep the machine-readable contract available before loading dependencies.
    if (process.argv.includes("--json")) {
      process.stdout.write(
        `${JSON.stringify({
          schemaVersion: 1,
          type: "error",
          error: { code: "cli.node_unsupported", message },
        })}\n`
      );
    } else {
      process.stderr.write(`${message}\n`);
    }
    process.exit(1);
  }
}

// Maintenance must remain loadable when the business command graph cannot start.
// Both distributions use this entry; normal commands keep their existing parser.
if (
  process.platform === "win32" &&
  /[\\/]openmeld\.exe$/iu.test(process.execPath) &&
  !process.argv.includes("--openmeld-windows-task")
) {
  const { restoreWindowsPreviewChannel } = await import(
    "./local-components/windows-preview-channel"
  );
  await restoreWindowsPreviewChannel();
}
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
  // The Host process ends with its supervised session. By now accepted work
  // has drained and Host ownership is released. A read-only background probe
  // that is still running, such as a controller report launching agent CLIs,
  // must not keep this process alive: the Service waits for this exit before
  // it clears its runtime state, so a lingering probe would stall every stop.
  // Its agent CLIs end with it instead of outliving the Host.
  try {
    const { terminateLiveAgentControllerProcesses } = await import(
      "@openmeld/adapter-core"
    );
    terminateLiveAgentControllerProcesses("SIGTERM");
  } catch (error) {
    console.error("[openmeld.execution_host.probe_cleanup_failed]", error);
  }
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          stream.write("", () => resolve());
        })
    )
  );
  process.exit();
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
