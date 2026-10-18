import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPENMELD_HEADER_CREDENTIAL_CONFIRMATION,
  readTaskCredentialHeader,
} from "@openmeld/gateway-contract";
import { formatCredentialConfirmationRequiredMessage } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readDispatchTaskCredentialHeader,
  sendWithCredentialConfirmation,
} from "../src/config/sensitive-operation-credentials";
import { DISPATCH_OWNED_RUNTIME_MODE } from "../src/runtime/dispatch-runtime-env";
import { createDispatchSpaceActionContext } from "../src/runtime/dispatch-space-action-context";

// Credentials for sensitive operations (design-plans/member-agent-program.md
// §4.7): inside a Wake the CLI presents the task's credential; a 409
// credential_confirmation.required waits for the owner's answer.

const CONFIRMATION_HANDLE_PATTERN = /^[a-f0-9]{32}$/u;
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

const ECHO = {
  executionToken: `rcet_v1_${"a".repeat(64)}`,
  runId: "run-1",
  runtimeCoordinatorExecutionId: "rcx-1",
  tokenFingerprint: `etfp_v1_${"c".repeat(32)}`,
};

function wakeEnv(withToken: boolean): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), "openmeld-task-credential-"));
  homes.push(home);
  const { context, contextPath } = createDispatchSpaceActionContext({
    attemptId: "attempt-1",
    dispatchId: "dispatch-1",
    env: { OPENMELD_HOME: home },
    ...(withToken ? { executionTokenEcho: ECHO } : {}),
    sendTargetReference: {
      projection: [],
      referenceLines: [],
      status: "loaded",
    },
    sourceEventId: "source-1",
    spaceContractSnapshot: null,
    spaceId: "space-1",
    targetProfileId: "agt_test",
    taskId: "task-1",
  });
  return {
    OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID: context.dispatchId,
    OPENMELD_DISPATCH_RUNTIME_MODE: DISPATCH_OWNED_RUNTIME_MODE,
    OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID: context.targetProfileId,
    OPENMELD_HOME: home,
    OPENMELD_SPACE_ACTION_CONTEXT_PATH: contextPath,
  };
}

function confirmationRequired(confirmationId?: string): Response {
  return Response.json(
    {
      error: {
        code: "upstream_error",
        message: confirmationId
          ? formatCredentialConfirmationRequiredMessage(confirmationId)
          : "Confirm this change in your OpenMeld Inbox.",
        requestId: "request-1",
        upstreamCode: "credential_confirmation.required",
      },
      ok: false,
    },
    { status: 409 }
  );
}

function confirmation(status: string): Response {
  return Response.json({
    confirmation: {
      agentProfileId: "agt_test",
      agentProfileName: "PR Reviewer",
      createdAtMs: 1,
      decidedAtMs: status === "pending" ? null : 2,
      expiresAtMs: 10_000_000,
      id: "c".repeat(32),
      operation: "binding_permission_mode",
      status,
    },
  });
}

describe("task credential", () => {
  it("presents the Wake's execution token inside a Wake and nothing outside one", () => {
    const header = readDispatchTaskCredentialHeader(wakeEnv(true));
    expect(header).not.toBeNull();
    expect(
      readTaskCredentialHeader(
        new Headers({ "x-openmeld-task-credential": header ?? "" })
      )
    ).toEqual({ status: "present", taskCredential: ECHO });
    expect(readDispatchTaskCredentialHeader({})).toBeNull();
    expect(readDispatchTaskCredentialHeader(wakeEnv(false))).toBeNull();
  });
});

describe("owner confirmation", () => {
  const base = {
    baseUrl: "https://api.openmeld.test",
    headers: { authorization: "Bearer token" },
    log: () => undefined,
    sleep: () => Promise.resolve(),
  };

  it("waits for the owner's answer and repeats the same request once", async () => {
    const send = vi
      .fn<(headers: Record<string, string>) => Promise<Response>>()
      .mockResolvedValueOnce(confirmationRequired())
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const readConfirmation = vi
      .fn()
      .mockResolvedValueOnce(confirmation("pending"))
      .mockResolvedValueOnce(confirmation("approved"));
    const response = await sendWithCredentialConfirmation({
      ...base,
      env: {},
      method: "PATCH",
      readConfirmation,
      send,
    });
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    const handle =
      send.mock.calls[0]?.[0][OPENMELD_HEADER_CREDENTIAL_CONFIRMATION];
    expect(handle).toMatch(CONFIRMATION_HANDLE_PATTERN);
    expect(send.mock.calls[1]?.[0]).toEqual(send.mock.calls[0]?.[0]);
    expect(readConfirmation.mock.calls[0]?.[0]).toEqual({
      confirmationId: handle,
      url: `https://api.openmeld.test/v1/credential-confirmations/${handle}`,
    });
  });

  it("polls the pending confirmation Core names when a command is repeated", async () => {
    const pending = "p".repeat(32);
    const send = vi
      .fn<(headers: Record<string, string>) => Promise<Response>>()
      .mockResolvedValueOnce(confirmationRequired(pending))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const readConfirmation = vi
      .fn()
      .mockResolvedValueOnce(confirmation("approved"));
    await sendWithCredentialConfirmation({
      ...base,
      env: {},
      method: "PATCH",
      readConfirmation,
      send,
    });
    expect(readConfirmation.mock.calls[0]?.[0]).toMatchObject({
      confirmationId: pending,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a declined request", async () => {
    const send = vi.fn().mockResolvedValue(confirmationRequired());
    const response = await sendWithCredentialConfirmation({
      ...base,
      env: {},
      method: "POST",
      readConfirmation: vi.fn().mockResolvedValue(confirmation("declined")),
      send,
    });
    expect(response.status).toBe(409);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never waits inside the Service or for a read", async () => {
    const readConfirmation = vi.fn();
    const send = vi.fn().mockResolvedValue(confirmationRequired());
    const response = await sendWithCredentialConfirmation({
      ...base,
      env: { OPENMELD_DAEMON_RUNTIME_MODE: "background" },
      method: "PATCH",
      readConfirmation,
      send,
    });
    expect(response.status).toBe(409);
    const get = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    await sendWithCredentialConfirmation({
      ...base,
      env: {},
      method: "GET",
      readConfirmation,
      send: get,
    });
    expect(get.mock.calls[0]?.[0]).not.toHaveProperty(
      OPENMELD_HEADER_CREDENTIAL_CONFIRMATION
    );
    expect(readConfirmation).not.toHaveBeenCalled();
  });
});
