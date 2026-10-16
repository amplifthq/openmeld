import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unwatchFile, watchFile } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { normalizeCommandEnvironment } from "@openmeld/adapter-core/process-environment";
import {
  execPlatformFile as execFile,
  resolvePlatformCommand,
} from "@openmeld/adapter-core/process-launch";
import { createComputerAuthorizationGrant } from "@openmeld/api-client";
import {
  type ComputerSetupOutput,
  computerConnectionReviewSchema,
  computerSetupOutputSchema,
  DESKTOP_APP_ORIGIN,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopComputerConnectionProgress,
  type DesktopComputerConnectionRequest,
  type DesktopComputerConnectionResult,
  type DesktopComputerDisconnectPhase,
  type DesktopComputerDisconnectResult,
  desktopComputerConnectionRequestSchema,
  desktopComputerDisconnectRequestSchema,
  localMachineIssueAgentEventSchema,
  prepareSessionResponseSchema,
  prepareSessionWithTokenResponseSchema,
  redactPrepareStepDiagnosticsText,
  SERVICE_ACCOUNT_STOP_REFUSED_CODE,
} from "@openmeld/schemas";
import type { PrepareSessionSnapshot } from "@openmeld/schemas/types";
import type { CommandDeps } from "./cli/commands";
import { installComputerTools } from "./cli/computer-tools";
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
    let prepareSessionId: string | null = null;
    const observe = createConnectionProgressObserver({
      expectedAccount: intent.expectedAccount,
      onProgress: input.onProgress,
      prepareSessionId: () => prepareSessionId,
    });
    try {
      const sessionRevision = input.sessionRevision?.();
      observe("checking", "desktop.connection.checking");
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
      const selectedBin = resolveOpenMeldBin({
        env: deps.env,
        override: deps.openMeldBin,
      });
      const inspected = await reviewComputerConnection(
        selectedBin,
        input.webOrigin,
        deps,
        observe,
        {
          includeStopped: Boolean(intent.connectedComputerId),
          allowBootstrap: !(
            intent.serviceAction === "update_service" &&
            intent.connectedComputerId
          ),
        }
      );
      const switchingAccount = isSwitchingAccount(
        inspected.review.account,
        account.id
      );
      if (switchingAccount) {
        observe(
          "waiting_for_confirmation",
          "desktop.connection.waiting_for_confirmation"
        );
      }
      if (
        !(await approveAccountSwitch(
          inspected.review.account,
          account,
          input.confirmSwitch
        ))
      ) {
        observe(
          "waiting_for_confirmation",
          "desktop.connection.switch_cancelled",
          { state: "completed" }
        );
        return { status: "cancelled" };
      }
      const { review } = inspected;
      const canReuse = !(
        intent.serviceAction ||
        intent.resetThisComputer ||
        intent.targetSpaceId ||
        intent.sourceNavigationAction ||
        intent.connectedComputerId
      );
      if (
        canReuse &&
        review.account?.id === account.id &&
        review.existingConnection
      ) {
        await assertAccount();
        observe("connected", "desktop.connection.reused", {
          state: "completed",
        });
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
      prepareSessionId = prepare.snapshot.prepareSessionId;
      const connectionPhase = switchingAccount
        ? "switching_account"
        : "connecting_service";
      observe(connectionPhase, `desktop.connection.${connectionPhase}`);
      const result = await withPrepareDiagnostics(
        prepare.snapshot.diagnosticCorrelationId,
        async () => {
          if (prepare.snapshot.ownerUserId !== account.id) {
            throw new Error(
              "The computer connection belongs to another account."
            );
          }
          assertPrepareConnectionTarget({
            intent,
            snapshot: prepare.snapshot,
            review,
          });
          const { bin, review: setupReview } =
            await prepareReviewedComputerTools({
              serviceAction: intent.serviceAction,
              inspected,
              webOrigin: input.webOrigin,
              deps,
              observe,
              assertAccount,
            });
          assertPrepareConnectionTarget({
            intent,
            snapshot: prepare.snapshot,
            review: setupReview,
          });
          const grant = await createComputerAuthorizationGrant(
            (path, method, body) => cloud(`/api/auth${path}`, method, body),
            { clientId: deps.env?.OPENMELD_AUTH_CLIENT_ID }
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
                    previousSessionIdentity:
                      setupReview.previousSessionIdentity,
                  }),
                ],
                deps.env,
                {
                  onProgress: (event) => {
                    if (input.sessionRevision?.() !== sessionRevision) {
                      return;
                    }
                    const phase = phaseForSetupEvent(event);
                    observe(phase, event.code, {
                      detail: event.message,
                      state: event.state,
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
      observeConnectionResult(result, observe);
      return result;
    } catch (error) {
      observe("needs_attention", "desktop.connection.failed", {
        detail: error instanceof Error ? error.message : undefined,
        state: "failed",
      });
      throw error;
    } finally {
      pending = false;
    }
  };
}

function isSwitchingAccount(
  previous: { id: string } | null,
  nextAccountId: string
) {
  return previous !== null && previous.id !== nextAccountId;
}

function observeConnectionResult(
  result: DesktopComputerConnectionResult,
  observe: ReturnType<typeof createConnectionProgressObserver>
) {
  if (result.status === "completed") {
    observe("connected", "desktop.connection.connected", {
      state: "completed",
    });
  } else if (result.status === "failed") {
    observe("needs_attention", "desktop.connection.failed", {
      detail: result.message,
      state: "failed",
    });
  }
}

function createConnectionProgressObserver(input: {
  expectedAccount: string;
  onProgress?: (progress: DesktopComputerConnectionProgress) => void;
  prepareSessionId(): string | null;
}) {
  const operationId = randomUUID();
  const startedAt = new Date().toISOString();
  let sequence = 0;
  return (
    phase: DesktopComputerConnectionProgress["phase"],
    code: string,
    options: {
      detail?: string;
      measurement?: DesktopComputerConnectionProgress["measurement"];
      state?: DesktopComputerConnectionProgress["state"];
    } = {}
  ) => {
    const progress: DesktopComputerConnectionProgress = {
      schemaVersion: 1,
      expectedAccount: input.expectedAccount,
      operationId,
      attemptId: operationId,
      prepareSessionId: input.prepareSessionId(),
      sequence: sequence++,
      startedAt,
      observedAt: new Date().toISOString(),
      phase,
      state: options.state ?? "active",
      code,
      ...(options.measurement ? { measurement: options.measurement } : {}),
      ...(options.detail ? { detail: options.detail } : {}),
    };
    // Observation must never control or interrupt the connection operation.
    try {
      input.onProgress?.(progress);
    } catch {
      // The authoritative setup path continues without an observer.
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

const DISCONNECT_CONNECTION_CHANGED = {
  status: "connection_changed",
  code: "desktop.disconnect.connection_changed",
  message:
    "The account or this Mac’s connection changed. Disconnect was not started. Check the connection again.",
} as const satisfies DesktopComputerDisconnectResult;

function presentDisconnectFailure(
  error: unknown,
  commandRequested: boolean,
  commandStarted: boolean
): DesktopComputerDisconnectResult {
  const unconfirmed = {
    status: "unconfirmed",
    code: "desktop.disconnect.unconfirmed",
    message:
      "Disconnect may have been accepted, but its final result could not be confirmed. Check the connection before trying again.",
  } as const;
  if (error instanceof ComputerOperationError) {
    const diagnostics = { diagnosticsPath: error.diagnosticsPath };
    if (
      error.code === "service.account_admission.account_changed" ||
      error.code === "service.account_admission.account_mismatch"
    ) {
      return {
        ...DISCONNECT_CONNECTION_CHANGED,
        code: error.code,
        ...diagnostics,
      };
    }
    if (error.code === SERVICE_ACCOUNT_STOP_REFUSED_CODE) {
      return {
        status: "failed",
        code: error.code,
        message:
          "The Service did not accept Disconnect. Check its status before trying again.",
        ...diagnostics,
      };
    }
    return { ...unconfirmed, ...diagnostics };
  }
  if (commandStarted) {
    return unconfirmed;
  }
  return {
    status: "failed",
    code: commandRequested
      ? "desktop.disconnect.start_failed"
      : "desktop.disconnect.check_failed",
    message:
      "Disconnect was not started. Check your sign-in and OpenMeld Tools, then check the connection again.",
  };
}

export function createComputerDisconnection(input: {
  auth: Pick<PilotAuth, "session">;
  commandDeps: CommandDeps;
  confirmDisconnect(): Promise<boolean>;
  sessionRevision?(): number;
  onPhase?(phase: DesktopComputerDisconnectPhase): void;
}) {
  return async (request: unknown): Promise<DesktopComputerDisconnectResult> => {
    const intent = desktopComputerDisconnectRequestSchema.parse(request);
    const revision = input.sessionRevision?.();
    const accountMatches = async () =>
      (await input.auth.session()).user?.id === intent.expectedAccount &&
      input.sessionRevision?.() === revision;
    const changed = DISCONNECT_CONNECTION_CHANGED;
    const reportPhase = (phase: DesktopComputerDisconnectPhase) => {
      try {
        input.onPhase?.(phase);
      } catch {
        // UI observation cannot cancel or change the native operation.
      }
    };
    let commandRequested = false;
    let commandStarted = false;
    try {
      reportPhase("checking");
      assertConnectionEnvironment(input.commandDeps.env);
      const bin = resolveOpenMeldBin({
        env: input.commandDeps.env,
        override: input.commandDeps.openMeldBin,
      });
      // These are independent reads, not permission to mutate. The CLI still
      // rechecks the exact reviewed session and Service ownership under its lock.
      const [sameAccount, review] = await Promise.all([
        accountMatches(),
        readComputerConnection(bin, input.commandDeps),
      ]);
      if (
        !sameAccount ||
        input.sessionRevision?.() !== revision ||
        review.account?.id !== intent.expectedAccount ||
        (intent.expectedConnection &&
          (review.existingConnection?.deviceId !==
            intent.expectedConnection.deviceId ||
            review.existingConnection.runtimeLane !==
              intent.expectedConnection.runtimeLane))
      ) {
        return changed;
      }
      reportPhase("waiting_for_confirmation");
      if (!(await input.confirmDisconnect())) {
        return { status: "cancelled" };
      }
      if (!(await accountMatches())) {
        return changed;
      }
      reportPhase("disconnecting");
      commandRequested = true;
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
        {
          completedEvent: "computer.disconnected",
          onStarted: () => {
            commandStarted = true;
          },
        }
      );
      return { status: "disconnected" };
    } catch (error) {
      return presentDisconnectFailure(error, commandRequested, commandStarted);
    }
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

// Shared by the read-only projection and the explicit Connect bootstrap. Do not
// interpret authentication failures or malformed review output as missing tools.
export function isComputerConnectionBootstrapError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const failure = error as { code?: unknown; stderr?: unknown };
  return (
    failure.code === "ENOENT" ||
    (failure.code === 1 &&
      typeof failure.stderr === "string" &&
      UNSUPPORTED_CONNECTION_COMMAND.test(failure.stderr))
  );
}

export async function readComputerConnection(
  bin: string,
  deps: CommandDeps,
  options: { includeStopped?: boolean } = {}
) {
  const args = ["computer", "connection-review", "--json"];
  const execute = (commandArgs: string[]) =>
    promisify(execFile)(bin, commandArgs, {
      env: deps.env,
      timeout: 10_000,
      maxBuffer: 16_384,
    });
  const result = await execute(
    options.includeStopped ? [...args, "--include-stopped"] : args
  ).catch((error: unknown) => {
    // Older carriers support only the running-connection review. Retry only
    // explicit unsupported-command errors, never failed identity checks.
    if (
      options.includeStopped &&
      (error as { code?: unknown })?.code === 1 &&
      isComputerConnectionBootstrapError(error)
    ) {
      return execute(args);
    }
    throw error;
  });
  return computerConnectionReviewSchema.parse(JSON.parse(result.stdout));
}

async function reviewComputerConnection(
  bin: string,
  webOrigin: string,
  deps: CommandDeps,
  observe: (
    phase: DesktopComputerConnectionProgress["phase"],
    code: string,
    options?: {
      measurement?: DesktopComputerConnectionProgress["measurement"];
    }
  ) => void,
  options: {
    forceInstall?: boolean;
    allowBootstrap?: boolean;
    includeStopped?: boolean;
  } = {}
) {
  if (!options.forceInstall) {
    try {
      return {
        bin,
        review: await readComputerConnection(bin, deps, {
          includeStopped: options.includeStopped,
        }),
        installedNow: false,
      };
    } catch (error) {
      if (!isComputerConnectionBootstrapError(error)) {
        throw error;
      }
      if (options.allowBootstrap === false) {
        throw new Error(
          "OpenMeld cannot verify this computer. Open Desktop on the selected computer and connect it before updating.",
          { cause: error }
        );
      }
    }
  }
  const installedBin = await installComputerTools(webOrigin, deps, {
    onDownloadProgress: (progress) =>
      observe("downloading", "desktop.tools.download", {
        measurement: {
          unit: "bytes",
          value: progress.receivedBytes,
          total: progress.totalBytes,
          transferAttempt: progress.transferAttempt,
        },
      }),
    onStage: (stage) => observe(stage, `desktop.tools.${stage}`),
  });
  return {
    bin: installedBin,
    review: await readComputerConnection(installedBin, deps, {
      includeStopped: options.includeStopped,
    }),
    installedNow: true,
  };
}

async function prepareReviewedComputerTools(input: {
  serviceAction: DesktopComputerConnectionRequest["serviceAction"];
  inspected: Awaited<ReturnType<typeof reviewComputerConnection>>;
  webOrigin: string;
  deps: CommandDeps;
  observe: Parameters<typeof reviewComputerConnection>[3];
  assertAccount(): Promise<unknown>;
}) {
  if (
    input.serviceAction !== "update_service" ||
    input.inspected.installedNow
  ) {
    return input.inspected;
  }
  await input.assertAccount();
  // The verified installer owns acquisition. CLI setup then joins and verifies
  // the canonical Service update; native main does not become another updater.
  const updated = await reviewComputerConnection(
    input.inspected.bin,
    input.webOrigin,
    input.deps,
    input.observe,
    { forceInstall: true, includeStopped: true }
  );
  if (
    (updated.review.account?.id ?? null) !==
    (input.inspected.review.account?.id ?? null)
  ) {
    throw new Error("Local sign-in changed. Check the account and try again.");
  }
  await input.assertAccount();
  return updated;
}

function assertPrepareConnectionTarget(input: {
  intent: DesktopComputerConnectionRequest;
  snapshot: PrepareSessionSnapshot;
  review: Awaited<ReturnType<typeof readComputerConnection>>;
}) {
  const { intent, snapshot, review } = input;
  if (
    (intent.humanProfileId &&
      snapshot.humanProfileId !== intent.humanProfileId) ||
    (intent.targetSpaceId && snapshot.targetSpaceId !== intent.targetSpaceId) ||
    (intent.connectedComputerId &&
      (!review.existingConnection ||
        snapshot.deviceId !== review.existingConnection.deviceId ||
        snapshot.runtimeLane !== review.existingConnection.runtimeLane))
  ) {
    throw new Error(
      "The connection request does not match this profile, Space, or computer."
    );
  }
}

function phaseForSetupEvent(event: {
  code: string;
  phase?: DesktopComputerConnectionProgress["phase"];
}): DesktopComputerConnectionProgress["phase"] {
  if (event.phase) {
    return event.phase;
  }
  const legacyPhaseByCode: Record<
    string,
    DesktopComputerConnectionProgress["phase"]
  > = {
    "prepare.session.progress.refresh_service": "connecting_service",
    "prepare.session.progress.report_runtime": "confirming",
    "prepare.session.progress.verify_setup": "confirming",
  };
  return legacyPhaseByCode[event.code] ?? "connecting_service";
}

export async function runConnectionSetup(
  bin: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  options: {
    completedEvent?: "setup.complete" | "computer.disconnected";
    onStarted?(): void;
    onProgress?(progress: {
      code: string;
      message: string;
      phase?: DesktopComputerConnectionProgress["phase"];
      state?: DesktopComputerConnectionProgress["state"];
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
  let failureCode: string | null = null;
  const acceptLine = (line: string) => {
    const parsedLine = parseComputerSetupOutputLine(line);
    if (parsedLine.kind === "unstructured") {
      // Native startup failures can precede the CLI's structured presenter.
      // Preserve their redacted text as diagnostics, never as progress/state.
      remember({ code: "process.output", message: redact(line.trim()) });
      return;
    }
    if (parsedLine.kind === "ignored") {
      return;
    }
    const { event, raw } = parsedLine;
    const issue = localMachineIssueAgentEventSchema.safeParse(raw);
    const failed = isSetupFailure(event, issue.success);
    if (failed) {
      completed = false;
      failureCode = event.code;
    } else if (event.code === (options.completedEvent ?? "setup.complete")) {
      completed = true;
    }
    const message = redact(resolveSetupEventMessage(event, issue));
    if (!message) {
      return;
    }
    const progressState = resolveSetupProgressState(event.data?.state);
    const item = {
      code: event.code,
      message,
      ...(event.data?.phase ? { phase: event.data.phase } : {}),
      ...(progressState ? { state: progressState } : {}),
    };
    remember(item);
    if (failed) {
      failure = message;
    }
    if (isObservableSetupEvent(event)) {
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
    const commandEnv = normalizeCommandEnvironment(env ?? process.env);
    const invocation = resolvePlatformCommand(bin, args, commandEnv);
    const child = spawn(invocation.bin, invocation.args, {
      env: commandEnv,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      windowsHide: true,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    child.once("spawn", () => {
      try {
        options.onStarted?.();
      } catch {
        // Starting a UI observer is not part of command success.
      }
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
        diagnosticsPath,
        failureCode
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

function resolveSetupEventMessage(
  event: ComputerSetupOutput,
  issue: ReturnType<typeof localMachineIssueAgentEventSchema.safeParse>
) {
  return issue.success
    ? issue.data.message
    : (event.message ?? event.text ?? "");
}

function isSetupFailure(event: ComputerSetupOutput, isMachineIssue: boolean) {
  return (
    isMachineIssue || event.type === "error" || event.data?.state === "failed"
  );
}

function isObservableSetupEvent(event: ComputerSetupOutput) {
  return Boolean(event.data?.state) || event.type === "error";
}

function parseComputerSetupOutputLine(
  line: string
):
  | { kind: "event"; event: ComputerSetupOutput; raw: unknown }
  | { kind: "ignored" }
  | { kind: "unstructured" } {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { kind: "unstructured" };
  }
  const parsed = computerSetupOutputSchema.safeParse(raw);
  return parsed.success
    ? { kind: "event", event: parsed.data, raw }
    : { kind: "ignored" };
}

function resolveSetupProgressState(
  state: string | undefined
): DesktopComputerConnectionProgress["state"] | undefined {
  if (state === "started" || state === "active") {
    return "active";
  }
  if (state === "completed" || state === "failed") {
    return state;
  }
  return undefined;
}

class ComputerOperationError extends Error {
  readonly diagnosticsPath: string;
  readonly code: string | null;
  constructor(message: string, diagnosticsPath: string, code: string | null) {
    super(message);
    this.diagnosticsPath = diagnosticsPath;
    this.code = code;
  }
}
