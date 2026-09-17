import { execFile, spawn } from "node:child_process";
import { unwatchFile, watchFile } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createComputerAuthorizationGrant } from "@openmeld/api-client";
import {
  computerConnectionReviewSchema,
  computerSetupOutputSchema,
  DESKTOP_APP_ORIGIN,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopComputerConnectionProgress,
  type DesktopComputerConnectionResult,
  desktopComputerConnectionRequestSchema,
  desktopComputerDisconnectRequestSchema,
  localMachineIssueAgentEventSchema,
  prepareSessionResponseSchema,
  prepareSessionWithTokenResponseSchema,
  redactPrepareStepDiagnosticsText,
} from "@openmeld/schemas";
import type { CommandDeps } from "./cli/commands";
import { installManagedBinary } from "./cli/managed-binary";
import { resolveOpenMeldBin } from "./cli/resolve-openmeld";
import type { PilotAuth } from "./pilot-auth";

export function createComputerConnection(input: {
  auth: Pick<PilotAuth, "session" | "cloudRequest">;
  commandDeps: CommandDeps;
  webOrigin: string;
  webBuild: string;
  installed: boolean;
  ensureCompatible(): Promise<void>;
  confirmSwitch(previousAccount: string, nextAccount: string): Promise<boolean>;
  sessionRevision?(): number;
  onProgress?(progress: DesktopComputerConnectionProgress): void;
}) {
  let pending = false;
  return async (request: unknown): Promise<DesktopComputerConnectionResult> => {
    const intent = desktopComputerConnectionRequestSchema.parse(request);
    if (pending) {
      throw new Error("A computer connection is already in progress.");
    }
    pending = true;
    try {
      const sessionRevision = input.sessionRevision?.();
      await input.ensureCompatible();
      const assertAccount = async () => {
        const session = await input.auth.session();
        if (session.user?.id !== intent.expectedAccount) {
          throw new Error(
            "Desktop sign-in changed. Check the account and try again."
          );
        }
        return session.user;
      };
      const account = await assertAccount();
      const deps = input.commandDeps;
      assertConnectionEnvironment(deps.env);
      const bin = resolveOpenMeldBin({
        env: deps.env,
        override: deps.openMeldBin,
      });
      const review = await reviewComputerConnection(bin, input.webOrigin, deps);
      if (
        !(await approveAccountSwitch(
          review.account,
          account,
          input.confirmSwitch
        ))
      ) {
        return { status: "cancelled" };
      }
      const canReuse = !(
        intent.resetThisComputer ||
        intent.sourceNavigationAction ||
        intent.connectedComputerId
      );
      if (
        canReuse &&
        review.account?.id === account.id &&
        review.existingConnection
      ) {
        await assertAccount();
        return { status: "reused", connection: review.existingConnection };
      }
      const cloud = async (
        path: string,
        method: "GET" | "POST",
        body?: unknown
      ) => {
        await assertAccount();
        const headers = new Headers({
          origin: DESKTOP_APP_ORIGIN,
          "content-type": "application/json",
        });
        headers.set(
          input.installed ? DESKTOP_CONTRACT_HEADER : DESKTOP_WEB_BUILD_HEADER,
          input.installed ? DESKTOP_CONTRACT_VERSION : input.webBuild
        );
        const response = await input.auth.cloudRequest(path, {
          method,
          headers,
          body:
            body === undefined
              ? undefined
              : new TextEncoder().encode(JSON.stringify(body)).buffer,
        });
        if (!response.ok) {
          throw new Error(
            `Computer connection could not continue (HTTP ${response.status}). Try again.`
          );
        }
        return await response.json();
      };
      const prepare = prepareSessionWithTokenResponseSchema.parse(
        await cloud("/v1/prepare/sessions", "POST", {
          humanProfileId: intent.humanProfileId,
          targetSpaceId: intent.targetSpaceId,
          selectedLocalAgentIds: [],
          sourceNavigationAction: intent.sourceNavigationAction,
          connectedComputerId: intent.connectedComputerId,
        })
      );
      return await withPrepareDiagnostics(
        prepare.snapshot.diagnosticCorrelationId,
        async () => {
          if (prepare.snapshot.ownerUserId !== account.id) {
            throw new Error(
              "The computer connection belongs to another account."
            );
          }
          const grant = await createComputerAuthorizationGrant(
            (path, method, body) => cloud(`/api/auth${path}`, method, body)
          );
          await assertAccount();
          return await finishConnectionSetup({
            diagnosticId: prepare.snapshot.diagnosticCorrelationId,
            setup: () =>
              runConnectionSetup(
                bin,
                [
                  "setup",
                  "--view",
                  "agent",
                  "--start-session",
                  prepare.opaqueToken,
                  "--device-code",
                  grant.deviceCode,
                  "--local-agents",
                  "none",
                  "--connection-intent",
                  JSON.stringify({
                    expectedAccount: account.id,
                    previousSessionIdentity: review.previousSessionIdentity,
                  }),
                ],
                deps.env,
                {
                  onProgress: (event) => {
                    if (input.sessionRevision?.() !== sessionRevision) {
                      return;
                    }
                    input.onProgress?.({
                      expectedAccount: account.id,
                      ...event,
                    });
                  },
                }
              ),
            readSnapshot: () =>
              cloud(
                `/v1/prepare/sessions/${encodeURIComponent(prepare.snapshot.prepareSessionId)}`,
                "GET"
              ),
          });
        }
      );
    } finally {
      pending = false;
    }
  };
}

async function finishConnectionSetup(input: {
  diagnosticId: string;
  setup(): Promise<void>;
  readSnapshot(): Promise<unknown>;
}): Promise<DesktopComputerConnectionResult> {
  let failure: string | null = null;
  let diagnosticsPath: string | undefined;
  try {
    await input.setup();
  } catch (error) {
    failure =
      error instanceof Error
        ? error.message
        : "This computer could not connect. Try again.";
    if (error instanceof ComputerOperationError) {
      diagnosticsPath = error.diagnosticsPath;
    }
  }
  try {
    const { snapshot } = prepareSessionResponseSchema.parse(
      await input.readSnapshot()
    );
    if (snapshot.lifecycleStatus === "completed" && !failure) {
      return { status: "completed", snapshot };
    }
    const step = snapshot.steps.find((entry) => entry.state === "blocked");
    if (step?.summary && failure && !failure.includes(step.summary)) {
      failure = `${step.summary} ${failure}`;
    }
    failure ??=
      step?.summary ??
      "This computer has not finished connecting. Try again to check its progress.";
  } catch (error) {
    failure ??=
      error instanceof Error
        ? error.message
        : "Could not check the connection. Try again.";
  }
  return {
    status: "failed",
    message: redactPrepareStepDiagnosticsText(failure),
    diagnosticId: input.diagnosticId,
    ...(diagnosticsPath ? { diagnosticsPath } : {}),
  };
}

export function createComputerDisconnection(input: {
  auth: Pick<PilotAuth, "session">;
  commandDeps: CommandDeps;
  confirmDisconnect(): Promise<boolean>;
}) {
  return async (request: unknown): Promise<boolean> => {
    const intent = desktopComputerDisconnectRequestSchema.parse(request);
    const assertAccount = async () => {
      if ((await input.auth.session()).user?.id !== intent.expectedAccount) {
        throw new Error(
          "Desktop sign-in changed. Review the connection again."
        );
      }
    };
    await assertAccount();
    assertConnectionEnvironment(input.commandDeps.env);
    const bin = resolveOpenMeldBin({
      env: input.commandDeps.env,
      override: input.commandDeps.openMeldBin,
    });
    const review = await readComputerConnection(bin, input.commandDeps);
    if (review.account?.id !== intent.expectedAccount) {
      throw new Error(
        "This Mac is connected to a different account. Its connection was not changed."
      );
    }
    if (!(await input.confirmDisconnect())) {
      return false;
    }
    await assertAccount();
    try {
      await runConnectionSetup(
        bin,
        [
          "computer",
          "disconnect",
          "--connection-intent",
          JSON.stringify({
            expectedAccount: intent.expectedAccount,
            previousSessionIdentity: review.previousSessionIdentity,
          }),
          "--view",
          "agent",
        ],
        input.commandDeps.env,
        { completedEvent: "computer.disconnected" }
      );
    } catch (error) {
      if (error instanceof ComputerOperationError) {
        throw new Error(
          `${error.message} Diagnostic file: ${error.diagnosticsPath}`
        );
      }
      throw error;
    }
    return true;
  };
}

async function withPrepareDiagnostics(
  diagnosticId: string,
  operation: () => Promise<DesktopComputerConnectionResult>
): Promise<DesktopComputerConnectionResult> {
  try {
    return await operation();
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof Error
          ? error.message
          : "This computer could not connect. Try again.",
      diagnosticId,
    };
  }
}

async function approveAccountSwitch(
  previous: { id: string; email: string | null } | null,
  next: { id: string; email: string },
  confirm: (previous: string, next: string) => Promise<boolean>
) {
  if (!previous || previous.id === next.id) {
    return true;
  }
  return await confirm(previous.email ?? previous.id, next.email);
}

function assertConnectionEnvironment(env?: NodeJS.ProcessEnv) {
  if (
    env?.OPENMELD_ENV_PRESET !== "prod" &&
    !(env?.OPENMELD_HOME && env.OPENMELD_AUTH_URL && env.OPENMELD_GATEWAY_URL)
  ) {
    throw new Error(
      "This test build does not include a local computer connection environment."
    );
  }
}

const UNSUPPORTED_CONNECTION_COMMAND =
  /error: unknown command '(?:computer|connection-review)'/;
export async function readComputerConnection(bin: string, deps: CommandDeps) {
  const result = await promisify(execFile)(
    bin,
    ["computer", "connection-review", "--json"],
    { env: deps.env, timeout: 10_000, maxBuffer: 16_384 }
  );
  return computerConnectionReviewSchema.parse(JSON.parse(result.stdout));
}

async function reviewComputerConnection(
  bin: string,
  webOrigin: string,
  deps: CommandDeps
) {
  try {
    return await readComputerConnection(bin, deps);
  } catch (error) {
    const failure = error as { code?: string | number; stderr?: string };
    const unsupported =
      failure.code === 1 &&
      UNSUPPORTED_CONNECTION_COMMAND.test(failure.stderr ?? "");
    if (failure.code !== "ENOENT" && !unsupported) {
      throw error;
    }
    await installManagedBinary(webOrigin, deps);
    return await readComputerConnection(bin, deps);
  }
}

export async function runConnectionSetup(
  bin: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  options: {
    completedEvent?: "setup.complete" | "computer.disconnected";
    onProgress?(progress: {
      code: string;
      message: string;
    }): void | Promise<void>;
  } = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "openmeld-desktop-connect-"));
  const output = join(directory, "setup.log");
  const log = await open(output, "wx", 0o600);
  let preserve = false;
  let lastSize = 0;
  let reading: Promise<void> = Promise.resolve();
  const secrets = args
    .flatMap((arg, index) =>
      ["--start-session", "--device-code"].includes(arg)
        ? [args[index + 1] ?? ""]
        : []
    )
    .filter(Boolean);
  const redact = (value: string) =>
    redactPrepareStepDiagnosticsText(
      secrets.reduce(
        (text, secret) => text.split(secret).join("[redacted]"),
        value
      )
    ).slice(0, 4096);
  const events: { code: string; message: string }[] = [];
  const remember = (event: { code: string; message: string }) => {
    if (!event.message) {
      return;
    }
    events.push(event);
    if (events.length > 100) {
      events.shift();
    }
  };
  let completed = false;
  let failure: string | null = null;
  const acceptLine = (line: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      // Native startup failures can precede the CLI's structured presenter.
      // Preserve their redacted text as diagnostics, never as progress/state.
      remember({ code: "process.output", message: redact(line.trim()) });
      return;
    }
    const parsed = computerSetupOutputSchema.safeParse(raw);
    if (!parsed.success) {
      return;
    }
    const event = parsed.data;
    if (event.code === (options.completedEvent ?? "setup.complete")) {
      completed = true;
    }
    const issue = localMachineIssueAgentEventSchema.safeParse(raw);
    const message = redact(
      issue.success ? issue.data.message : (event.message ?? event.text ?? "")
    );
    if (!message) {
      return;
    }
    const item = { code: event.code, message };
    remember(item);
    if (
      issue.success ||
      event.type === "error" ||
      event.data?.state === "failed"
    ) {
      failure = message;
    }
    if (event.data?.state || event.type === "error") {
      // A slow or failed observer cannot consume output or change CLI success.
      Promise.resolve()
        .then(() => options.onProgress?.(item))
        .catch(() => undefined);
    }
  };
  const readOutput = async () => {
    const file = await open(output, "r");
    try {
      const { size } = await file.stat();
      if (size === lastSize) {
        return;
      }
      const start = Math.max(lastSize, size - 65_536);
      const buffer = Buffer.alloc(size - start);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      const content = buffer.subarray(0, bytesRead);
      const end = content.lastIndexOf(10);
      if (end < 0) {
        return;
      }
      lastSize = start + end + 1;
      for (const line of content
        .subarray(0, end)
        .toString("utf8")
        .split("\n")) {
        acceptLine(line);
      }
    } finally {
      await file.close();
    }
  };
  const refresh = () => {
    reading = reading.then(readOutput).catch(() => undefined);
  };
  try {
    const child = spawn(bin, args, {
      env,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    // The CLI's existing Prepare continuation and OS-managed Service survive
    // GUI exit. A regular file keeps output independent of the GUI's pipes.
    const completion = new Promise<number | null>((resolve, reject) => {
      child.once("error", (error) =>
        reject(
          new Error(
            `OpenMeld Tools could not start. ${redact(error.message)} Try connecting again.`
          )
        )
      );
      child.once("exit", resolve);
    });
    child.unref();
    watchFile(output, { interval: 250, persistent: false }, refresh);
    const [code] = await Promise.all([completion, log.close()]);
    unwatchFile(output, refresh);
    await reading;
    await readOutput();
    if (code !== 0 || !completed) {
      const diagnosticsPath = join(directory, "connection-diagnostics.json");
      await writeFile(
        diagnosticsPath,
        JSON.stringify({ exitCode: code, events }, null, 2),
        { mode: 0o600 }
      );
      await rm(output);
      preserve = true;
      throw new ComputerOperationError(
        failure ??
          (options.completedEvent === "computer.disconnected"
            ? "This Mac could not disconnect. Update OpenMeld Tools, then try again."
            : "OpenMeld could not finish connecting this computer. Review its connection details and try again."),
        diagnosticsPath
      );
    }
  } finally {
    unwatchFile(output, refresh);
    await log.close();
    if (!preserve) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

class ComputerOperationError extends Error {
  readonly diagnosticsPath: string;
  constructor(message: string, diagnosticsPath: string) {
    super(message);
    this.diagnosticsPath = diagnosticsPath;
  }
}
