import type {
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type CliLaunchCommand,
  type SpawnedAgentControllerProcess,
  spawnAgentControllerProcess,
} from "@openmeld/adapter-core";

/** Use the SDK's public spawn contract; its forwarded abort follows stdin-EOF grace. */
export function createClaudeWindowsProcessLauncher(command: CliLaunchCommand) {
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
          active.delete(runtime);
          resolve();
        });
      });
      active.set(runtime, closed);
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
        kill,
        on: child.on.bind(child),
        once: child.once.bind(child),
        off: child.off.bind(child),
      };
    },
    async cleanup(): Promise<void> {
      await Promise.all(
        [...active].map(async ([runtime, closed]) => {
          runtime.terminate("SIGKILL");
          const result = await runtime.terminateRemainingDescendants();
          if (!result.ok) {
            throw result.error;
          }
          await closed;
        })
      );
    },
  };
}
