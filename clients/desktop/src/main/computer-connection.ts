import { execFile, spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createComputerAuthorizationGrant } from "@openmeld/api-client";
import {
  computerConnectionReviewSchema,
  DESKTOP_APP_ORIGIN,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopComputerConnectionResult,
  desktopComputerConnectionRequestSchema,
  localMachineIssueAgentEventSchema,
  prepareSessionResponseSchema,
  prepareSessionWithTokenResponseSchema,
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
}) {
  let pending = false;
  return async (request: unknown): Promise<DesktopComputerConnectionResult> => {
    const intent = desktopComputerConnectionRequestSchema.parse(request);
    if (pending) {
      throw new Error("A computer connection is already in progress.");
    }
    pending = true;
    try {
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
          let setupFailure: string | null = null;
          try {
            await runConnectionSetup(
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
              deps.env
            );
          } catch (error) {
            setupFailure =
              error instanceof Error
                ? error.message
                : "This computer could not connect. Try again.";
          }
          const result = prepareSessionResponseSchema.parse(
            await cloud(
              `/v1/prepare/sessions/${encodeURIComponent(prepare.snapshot.prepareSessionId)}`,
              "GET"
            )
          );
          if (result.snapshot.lifecycleStatus !== "completed") {
            setupFailure ??=
              "This computer has not finished connecting. Try again to check its progress.";
          }
          if (setupFailure) {
            return {
              status: "failed",
              message: setupFailure,
              diagnosticId: result.snapshot.diagnosticCorrelationId,
            };
          }
          return { status: "completed", snapshot: result.snapshot };
        }
      );
    } finally {
      pending = false;
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
async function reviewComputerConnection(
  bin: string,
  webOrigin: string,
  deps: CommandDeps
) {
  const read = async () => {
    const result = await promisify(execFile)(
      bin,
      ["computer", "connection-review", "--json"],
      { env: deps.env, timeout: 10_000, maxBuffer: 16_384 }
    );
    return computerConnectionReviewSchema.parse(JSON.parse(result.stdout));
  };
  try {
    return await read();
  } catch (error) {
    const failure = error as { code?: string | number; stderr?: string };
    const unsupported =
      failure.code === 1 &&
      UNSUPPORTED_CONNECTION_COMMAND.test(failure.stderr ?? "");
    if (failure.code !== "ENOENT" && !unsupported) {
      throw error;
    }
    await installManagedBinary(webOrigin, deps);
    return await read();
  }
}

export async function runConnectionSetup(
  bin: string,
  args: string[],
  env?: NodeJS.ProcessEnv
) {
  const directory = await mkdtemp(join(tmpdir(), "openmeld-desktop-connect-"));
  const output = join(directory, "setup.log");
  const log = await open(output, "wx", 0o600);
  try {
    const child = spawn(bin, args, {
      env,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    // The CLI's existing Prepare continuation and OS-managed Service survive
    // GUI exit. A regular file keeps output independent of the GUI's pipes.
    const completion = new Promise<number | null>((resolve, reject) => {
      child.once("error", () =>
        reject(
          new Error("OpenMeld Tools could not start. Try connecting again.")
        )
      );
      child.once("exit", resolve);
    });
    child.unref();
    const [code] = await Promise.all([completion, log.close()]);
    const lines = (await readFile(output, "utf8")).split("\n");
    const completed = lines.some((line) => {
      try {
        return JSON.parse(line).code === "setup.complete";
      } catch {
        return false;
      }
    });
    if (code !== 0 || !completed) {
      for (const line of lines) {
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        const issue = localMachineIssueAgentEventSchema.safeParse(event);
        if (issue.success) {
          throw new Error(issue.data.message);
        }
      }
      throw new Error(
        "OpenMeld could not finish connecting this computer. Review its connection status and try again."
      );
    }
  } finally {
    await log.close();
    await rm(directory, { recursive: true, force: true });
  }
}
