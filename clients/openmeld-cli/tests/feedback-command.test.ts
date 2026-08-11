import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFeedback } from "../src/commands/feedback";
import { OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY } from "../src/config/feedback";
import { withCapturedStdio } from "./helpers/fs";

const {
  createCliApiClientFoundationMock,
  createFeedbackApiMock,
  resolveBaseUrlMock,
  resolveRuntimeContextMock,
  submitFeedbackIssueMock,
  toStructuredApiClientFailureMock,
} = vi.hoisted(() => ({
  createCliApiClientFoundationMock: vi.fn(),
  createFeedbackApiMock: vi.fn(),
  resolveBaseUrlMock: vi.fn(),
  resolveRuntimeContextMock: vi.fn(),
  submitFeedbackIssueMock: vi.fn(),
  toStructuredApiClientFailureMock: vi.fn(),
}));

vi.mock("@openmeld/api-client", () => ({
  createFeedbackApi: createFeedbackApiMock,
  toStructuredApiClientFailure: toStructuredApiClientFailureMock,
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: resolveBaseUrlMock,
}));

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: resolveRuntimeContextMock,
}));

vi.mock("../src/runtime/cli-version", () => ({
  getCliVersionInfo: () => ({ version: "0.2.23" }),
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: createCliApiClientFoundationMock,
}));

const SUCCESS_RESPONSE = {
  ok: true as const,
  issueId: "feedback_issue_f4980202-efe0-467c-bcc3-92760fce0c69",
};

describe("openmeld feedback", () => {
  let authenticated = false;
  let previousFeedbackInboxKey: string | undefined;
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.resetAllMocks();
    authenticated = false;
    previousFeedbackInboxKey = process.env.OPENMELD_FEEDBACK_INBOX_KEY;
    previousExitCode = process.exitCode;
    Reflect.deleteProperty(process.env, "OPENMELD_FEEDBACK_INBOX_KEY");
    process.exitCode = undefined;

    resolveBaseUrlMock.mockResolvedValue("http://localhost:8080");
    resolveRuntimeContextMock.mockImplementation(
      ({ view }: { view?: string } = {}) =>
        Promise.resolve({
          interactive: false,
          resolvedView: view === "agent" ? "agent" : "human",
          viewMode: view === "agent" ? "agent" : "human",
        })
    );
    createCliApiClientFoundationMock.mockImplementation(
      (
        _baseUrl: string,
        options?: {
          onAuthHeadersResolved?: (headers: Record<string, string>) => void;
        }
      ) => {
        options?.onAuthHeadersResolved?.(
          authenticated ? { Authorization: "Bearer test" } : {}
        );
        return { foundation: true };
      }
    );
    createFeedbackApiMock.mockReturnValue({
      submitFeedbackIssue: submitFeedbackIssueMock,
    });
    submitFeedbackIssueMock.mockResolvedValue(SUCCESS_RESPONSE);
    toStructuredApiClientFailureMock.mockImplementation(
      (error: { failure?: unknown }) => error.failure
    );
  });

  afterEach(() => {
    restoreEnv("OPENMELD_FEEDBACK_INBOX_KEY", previousFeedbackInboxKey);
    process.exitCode = previousExitCode;
  });

  it("splits a long message, appends details, truncates the merge, and reports signed-in Human View output", async () => {
    authenticated = true;
    const message = "M".repeat(3000);
    const details = "D".repeat(2000);

    const { stdout } = await withCapturedStdio(() =>
      runFeedback({ details, message, view: "human" })
    );

    const request = submitFeedbackIssueMock.mock.calls[0]?.[0];
    expect(request).toEqual({
      inboxKey: OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY,
      request: {
        category: "experience",
        summary: `${"M".repeat(197)}...`,
        details: `${message}\n\n${details}`.slice(0, 4000),
        submitterKind: "human",
        clientContext: {
          clientKind: "cli",
          clientVersion: "0.2.23",
          os: process.platform,
        },
      },
    });
    expect(stdout).toContain(
      `Feedback submitted — issue ID: ${SUCCESS_RESPONSE.issueId}. Thanks for helping us improve OpenMeld.`
    );
    expect(stdout).toContain("Category: experience · Submission: signed-in");
    expect(stdout).toContain(
      "Details were shortened to the 4,000-character limit."
    );
  });

  it.each([
    { view: "human", as: undefined, expected: "human" },
    { view: "agent", as: undefined, expected: "local_agent" },
    { view: "agent", as: "human", expected: "human" },
  ])("infers submitterKind $expected for view=$view and --as=$as", async ({
    view,
    as: submitterKind,
    expected,
  }) => {
    await runFeedback({
      message: "A focused feedback example",
      submitterKind,
      view,
    });

    expect(submitFeedbackIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ submitterKind: expected }),
      })
    );
  });

  it("omits clientContext completely with --no-context", async () => {
    await runFeedback({
      includeContext: false,
      message: "Do not include context",
      view: "human",
    });

    expect(submitFeedbackIssueMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "request.clientContext"
    );
  });

  it("rejects center_agent before making a request", async () => {
    await expect(
      runFeedback({
        message: "Center Agent report",
        submitterKind: "center_agent",
        view: "human",
      })
    ).rejects.toMatchObject({
      code: "feedback.submit.invalid_input",
      message:
        "--as accepts human or local_agent. center_agent is reserved for the Center Agent feedback flow.",
    });
    expect(submitFeedbackIssueMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid category and lists every valid value", async () => {
    await expect(
      runFeedback({
        category: "complaint",
        message: "Category validation",
        view: "human",
      })
    ).rejects.toMatchObject({
      code: "feedback.submit.invalid_input",
      message: "--category must be one of: bug, experience, idea, question.",
    });
    expect(submitFeedbackIssueMock).not.toHaveBeenCalled();
  });

  it("resolves inbox key as CLI option, then env, then the official default", async () => {
    process.env.OPENMELD_FEEDBACK_INBOX_KEY = "feedback_env";
    await runFeedback({
      inboxKey: "feedback_cli",
      message: "CLI override",
      view: "human",
    });
    await runFeedback({ message: "Environment override", view: "human" });
    Reflect.deleteProperty(process.env, "OPENMELD_FEEDBACK_INBOX_KEY");
    await runFeedback({ message: "Official default", view: "human" });

    expect(
      submitFeedbackIssueMock.mock.calls.map((call) => call[0].inboxKey)
    ).toEqual([
      "feedback_cli",
      "feedback_env",
      OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY,
    ]);
  });

  it.each([
    [
      "feedback.submit.inbox_not_found",
      "This feedback inbox could not be found. Check the inbox key and try again.",
    ],
    [
      "feedback.submit.rate_limited",
      "Too much feedback was submitted recently. Please wait a minute and try again.",
    ],
    [
      "feedback.submit.invalid_input",
      "OpenMeld could not submit this feedback because the input is invalid. Check the message, details, and email address, then try again.",
    ],
    [
      "network.request_failed",
      "OpenMeld could not reach the feedback service. Check your connection and try again.",
    ],
  ])("maps %s to accurate Human View copy", async (code, message) => {
    submitFeedbackIssueMock.mockRejectedValueOnce(
      apiFailure({ code, requestId: "req_feedback_123" })
    );

    await expect(
      runFeedback({ message: "Failure mapping", view: "human" })
    ).rejects.toMatchObject({ code, message, requestId: "req_feedback_123" });
  });

  it("emits one success envelope in Agent View", async () => {
    const { stdout } = await withCapturedStdio(() =>
      runFeedback({
        category: "bug",
        message: "The command did not finish",
        view: "agent",
      })
    );

    const lines = nonEmptyLines(stdout);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      schemaVersion: 1,
      type: "feedback_submitted",
      issueId: SUCCESS_RESPONSE.issueId,
      category: "bug",
      submitterKind: "local_agent",
      anonymous: true,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("emits one canonical error envelope and exits 1 in Agent View", async () => {
    submitFeedbackIssueMock.mockRejectedValueOnce(
      apiFailure({
        code: "feedback.submit.rate_limited",
        requestId: "req_feedback_rate_limit",
      })
    );

    const { stdout } = await withCapturedStdio(() =>
      runFeedback({ message: "Rate limit", view: "agent" })
    );

    const lines = nonEmptyLines(stdout);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      schemaVersion: 1,
      type: "error",
      error: {
        code: "feedback.submit.rate_limited",
        message:
          "Too much feedback was submitted recently. Please wait a minute and try again.",
        requestId: "req_feedback_rate_limit",
      },
    });
    expect(process.exitCode).toBe(1);
  });
});

function apiFailure(input: { code: string; requestId: string }) {
  return {
    failure: {
      code: input.code,
      message: "remote failure",
      requestId: input.requestId,
      status: null,
      upstreamCode: null,
    },
  };
}

function nonEmptyLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = previous;
}
