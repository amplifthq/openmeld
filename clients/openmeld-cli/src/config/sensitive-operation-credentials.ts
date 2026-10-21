import { randomUUID } from "node:crypto";
import {
  encodeTaskCredentialHeader,
  OPENMELD_HEADER_CREDENTIAL_CONFIRMATION,
} from "@openmeld/gateway-contract";
import {
  CREDENTIAL_CONFIRMATION_REQUIRED_CODE,
  CREDENTIAL_CONFIRMATION_TTL_MS,
  getCredentialConfirmationResponseSchema,
  readCredentialConfirmationIdFromMessage,
} from "@openmeld/schemas";
import {
  DISPATCH_OWNED_RUNTIME_MODE,
  OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
} from "../runtime/dispatch-runtime-env";
import { readDispatchSpaceActionContextForReceiptFromEnv } from "../runtime/dispatch-space-action-context";
import {
  DAEMON_SERVICE_RUNTIME_DETACHED_ENV,
  DAEMON_SERVICE_RUNTIME_MODE_ENV,
} from "./daemon-state";

// Credentials for sensitive operations (design-plans/member-agent-program.md
// §4.7). Inside a Wake the CLI presents the task's credential; outside one it
// uses the login credential, and Core may ask the owner to confirm.

const CONFIRMATION_POLL_INTERVAL_MS = 3000;
const TRAILING_SLASHES_PATTERN = /\/+$/u;

/**
 * The current Wake's task credential as a header value, or null outside a
 * Wake. A missing or unreadable context sends no credential; Core then treats
 * the request as the CLI login credential.
 */
export function readDispatchTaskCredentialHeader(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV] !== DISPATCH_OWNED_RUNTIME_MODE) {
    return null;
  }
  try {
    const echo =
      readDispatchSpaceActionContextForReceiptFromEnv(env).executionTokenEcho;
    return echo ? encodeTaskCredentialHeader(echo) : null;
  } catch {
    return null;
  }
}

type SendRequest = (headers: Record<string, string>) => Promise<Response>;

/**
 * Sends a request that may need the owner's confirmation. Core answers 409
 * `credential_confirmation.required` while a task with another root runs;
 * the CLI waits for the owner's answer in the Inbox, then repeats the same
 * request once. The Service never waits.
 */
export async function sendWithCredentialConfirmation(input: {
  baseUrl: string;
  headers: Record<string, string>;
  method: string | undefined;
  readConfirmation: (input: {
    confirmationId: string;
    url: string;
  }) => Promise<Response>;
  send: SendRequest;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
}): Promise<Response> {
  const method = (input.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return await input.send(input.headers);
  }
  const confirmationId = randomUUID().replaceAll("-", "");
  const headers = {
    ...input.headers,
    [OPENMELD_HEADER_CREDENTIAL_CONFIRMATION]: confirmationId,
  };
  const response = await input.send(headers);
  const required =
    response.status === 409 && !isServiceProcess(input.env ?? process.env)
      ? await readConfirmationRequired(response)
      : null;
  if (!required) {
    return response;
  }
  const log = input.log ?? ((message) => process.stderr.write(`${message}\n`));
  log(
    "This change needs your confirmation in the OpenMeld Inbox: a task requested by someone else is running on your computer. Waiting for your answer…"
  );
  const status = await waitForConfirmation({
    ...input,
    // A repeated command reuses the pending confirmation Core names.
    confirmationId: required.confirmationId ?? confirmationId,
    nowMs: input.nowMs ?? Date.now,
    sleep: input.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
  });
  if (status !== "approved") {
    log(
      status === "declined"
        ? "The change was declined in the OpenMeld Inbox."
        : "The confirmation was not answered in time."
    );
    return response;
  }
  return await input.send(headers);
}

async function waitForConfirmation(input: {
  baseUrl: string;
  confirmationId: string;
  nowMs: () => number;
  readConfirmation: (input: {
    confirmationId: string;
    url: string;
  }) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
}): Promise<"approved" | "declined" | "expired"> {
  const url = new URL(
    `/v1/credential-confirmations/${encodeURIComponent(input.confirmationId)}`,
    `${input.baseUrl.replace(TRAILING_SLASHES_PATTERN, "")}/`
  ).toString();
  const deadline = input.nowMs() + CREDENTIAL_CONFIRMATION_TTL_MS;
  while (input.nowMs() < deadline) {
    await input.sleep(CONFIRMATION_POLL_INTERVAL_MS);
    let response: Response;
    try {
      response = await input.readConfirmation({
        confirmationId: input.confirmationId,
        url,
      });
    } catch {
      continue;
    }
    if (!response.ok) {
      continue;
    }
    const parsed = getCredentialConfirmationResponseSchema.safeParse(
      await response.json().catch(() => null)
    );
    const status = parsed.success ? parsed.data.confirmation.status : null;
    if (status === "approved" || status === "declined") {
      return status;
    }
    if (status === "expired" || status === "consumed") {
      return "expired";
    }
  }
  return "expired";
}

async function readConfirmationRequired(
  response: Response
): Promise<{ confirmationId: string | null } | null> {
  // The Gateway nests its error; Auth answers with a flat one.
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as {
    code?: unknown;
    error?: { code?: unknown; message?: unknown; upstreamCode?: unknown };
    message?: unknown;
  } | null;
  const error = body?.error ?? body;
  const required =
    body?.error?.upstreamCode === CREDENTIAL_CONFIRMATION_REQUIRED_CODE ||
    error?.code === CREDENTIAL_CONFIRMATION_REQUIRED_CODE;
  return required
    ? {
        confirmationId: readCredentialConfirmationIdFromMessage(error?.message),
      }
    : null;
}

function isServiceProcess(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env[DAEMON_SERVICE_RUNTIME_MODE_ENV] ||
      env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] === "1"
  );
}
