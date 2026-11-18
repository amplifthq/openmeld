import {
  buildCliLaunchInvocation,
  type LaunchContractVerificationResult,
  type RuntimeAgentControllerLaunchContract,
  spawnAgentControllerProcess,
} from "@openmeld/adapter-core";

// Older Cursor builds open the Keychain before parsing --version and ignore
// AGENT_CLI_CREDENTIAL_STORE. Keep macOS services and Keychain files out of
// the probe process and its children. Only the parent checks saved sign-in.
const MACOS_PROBE_PROFILE = `(version 1)
(allow default)
(deny mach-lookup)
(deny network*)
(deny file-read* file-write* (regex #"/Library/Keychains(/|$)"))`;
const OUTPUT_LIMIT = 32_000;

type CursorProbeResult =
  | { ok: true; stdout: string }
  | Extract<LaunchContractVerificationResult, { ok: false }>;

export async function runCursorCliProbe(input: {
  command: "version" | "status";
  cwd: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  timeoutMs: number;
}): Promise<CursorProbeResult> {
  const checkingVersion = input.command === "version";
  const invocation = buildCliLaunchInvocation({
    launchContract: input.launchContract,
    args: checkingVersion ? ["--version"] : ["status", "--format", "json"],
  });
  const macOS = process.platform === "darwin";
  const incomplete = (errorMessage: string) =>
    ({ ok: false, failureKind: "incomplete_check", errorMessage }) as const;

  try {
    const controllerProcess = spawnAgentControllerProcess({
      bin: macOS ? "/usr/bin/sandbox-exec" : invocation.bin,
      args: macOS
        ? ["-p", MACOS_PROBE_PROFILE, invocation.bin, ...invocation.args]
        : invocation.args,
      cwd: input.cwd,
      env: {
        ...process.env,
        // Older builds test unlocking the login Keychain in an SSH session.
        ...(macOS ? { CI: "1" } : {}),
        ...(checkingVersion ? { AGENT_CLI_CREDENTIAL_STORE: "memory" } : {}),
      },
      shell: invocation.shell ?? false,
    });
    const { child } = controllerProcess;
    let stdout = "";
    let stderr = "";
    let cleanup: ReturnType<
      typeof controllerProcess.terminateRemainingDescendants
    >;
    const cleanUp = () => {
      cleanup ??= controllerProcess.terminateRemainingDescendants();
      return cleanup;
    };
    // A helper can inherit the pipes and keep "close" pending after "exit".
    child.once("exit", cleanUp);
    let timer: NodeJS.Timeout | undefined;
    const outcome = await new Promise<CursorProbeResult>((resolve) => {
      // Node can return a child without stdio and deliver EMFILE/ENFILE on
      // the next tick. Subscribe before touching any optional pipe.
      child.once("error", (error) => resolve(incomplete(error.message)));
      child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
        stdout = (stdout + chunk).slice(0, OUTPUT_LIMIT);
      });
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(0, OUTPUT_LIMIT);
      });
      timer = setTimeout(
        () =>
          resolve(
            incomplete(
              `Cursor CLI ${input.command} check timed out after ${input.timeoutMs}ms.`
            )
          ),
        input.timeoutMs
      );
      child.once("close", (code) => {
        if (macOS && stderr.startsWith("sandbox-exec:")) {
          resolve(
            incomplete(
              "macOS could not start the noninteractive Cursor CLI check."
            )
          );
        } else if (code === null) {
          resolve(incomplete("The Cursor CLI check was interrupted."));
        } else if (code === 0 || !checkingVersion) {
          // Some Cursor builds report signed-out status as JSON on a nonzero exit.
          resolve({ ok: true, stdout });
        } else {
          resolve({
            ok: false,
            failureKind: "completed_negative",
            errorMessage: `Cursor CLI version check exited with code ${code}.`,
          });
        }
      });
      child.stdin?.end();
    });
    clearTimeout(timer);
    if (controllerProcess.processId === null) {
      return outcome;
    }
    const cleaned = await cleanUp();
    if (cleaned.ok) {
      return outcome;
    }
    const detail = outcome.ok ? "" : `${outcome.errorMessage} `;
    return incomplete(
      `${detail}OpenMeld could not clean up the Cursor CLI check.`
    );
  } catch (error) {
    return incomplete(error instanceof Error ? error.message : String(error));
  }
}
