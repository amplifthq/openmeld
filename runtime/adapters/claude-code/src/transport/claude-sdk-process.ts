import type {
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type AdapterRuntimeProcessCallback,
  type CliLaunchCommand,
  type SpawnedAgentControllerProcess,
  spawnAgentControllerProcess,
} from "@openmeld/adapter-core";

const PROCESS_EXIT_GRACE_MS = 2000;

/** Use the SDK's public spawn contract; its forwarded abort follows stdin-EOF grace. */
export function createClaudeSdkProcessLauncher(
  command: CliLaunchCommand,
  onProcessControlEvent?: AdapterRuntimeProcessCallback
) {
  const active = new Map<SpawnedAgentControllerProcess, Promise<void>>();
  return {
    spawn(
      options: SpawnOptions,
      onStderr: (chunk: string) => void
    ): SpawnedProcess {
      if (options.command !== command.bin) {
        throw new Error(
          "Claude SDK changed the selected controller executable."
        );
      }
      if (options.signal.aborted) {
        throw new DOMException(
          "Claude invocation was cancelled before launch.",
          "AbortError"
        );
      }
      const runtime = spawnAgentControllerProcess({
        bin: command.bin,
        args: [...command.argsPrefix, ...options.args],
        cwd: options.cwd ?? process.cwd(),
        env: options.env,
        shell: false,
      });
      const { child } = runtime;
      let killed = false;
      const kill = (signal: NodeJS.Signals) => {
        const sent = runtime.terminate(signal);
        killed ||= sent;
        return sent;
      };
      const abort = () => kill("SIGKILL");
      const closed = new Promise<void>((resolve) => {
        child.once("close", () => {
          options.signal.removeEventListener("abort", abort);
          resolve();
        });
      });
      active.set(runtime, closed);
      try {
        onProcessControlEvent?.({
          phase: "process_spawned",
          processId: runtime.processId,
          signalTarget: runtime.signalTarget,
        });
      } catch (error) {
        runtime.terminate("SIGKILL");
        throw error;
      }
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", onStderr);
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) {
        abort();
      }
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        get killed() {
          return killed;
        },
        get exitCode() {
          return child.exitCode;
        },
        get signalCode() {
          return child.signalCode;
        },
        kill,
        on: child.on.bind(child),
        once: child.once.bind(child),
        off: child.off.bind(child),
      };
    },
    async cleanup(): Promise<void> {
      await Promise.all(
        [...active].map(async ([runtime, closed]) => {
          if (
            !(
              runtime.child.stdin.destroyed || runtime.child.stdin.writableEnded
            )
          ) {
            runtime.child.stdin.end();
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          const exited = await Promise.race([
            closed.then(() => true),
            new Promise<false>((resolve) => {
              timer = setTimeout(() => resolve(false), PROCESS_EXIT_GRACE_MS);
            }),
          ]).finally(() => clearTimeout(timer));
          if (!exited) {
            runtime.terminate("SIGKILL");
          }
          const result = await runtime.terminateRemainingDescendants();
          if (!result.ok) {
            throw result.error;
          }
          await closed;
          active.delete(runtime);
          onProcessControlEvent?.({
            phase: "process_exit",
            processId: runtime.processId,
            signalTarget: runtime.signalTarget,
          });
        })
      );
    },
  };
}
