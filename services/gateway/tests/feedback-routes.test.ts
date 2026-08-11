import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCloudflareFeedbackSubmitRateLimiter,
  FEEDBACK_SUBMIT_RATE_LIMITS,
  type FeedbackSubmitRateLimitResult,
} from "../src/feedback/feedback-submit-rate-limiter";
import app from "../src/index";
import {
  FEEDBACK_SUBMIT_ROUTE,
  parseAnonymousFeedbackSubmitRoute,
} from "../src/lib/anonymous-feedback-submit-route";
import {
  FEEDBACK_INBOX_LOG_ROUTE,
  redactFeedbackRouteForLogging,
} from "../src/lib/feedback-route-log-redaction";

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const INBOX_KEY = "feedback_key_test";
const FEEDBACK_ROUTE = `/v1/feedback/inboxes/${INBOX_KEY}/issues`;
const VALID_PAYLOAD = {
  category: "bug",
  summary: "The setup button did not respond.",
  details: "The page stayed unchanged after three attempts.",
  submitterKind: "human",
} as const;
const FEEDBACK_LOG_REDACTION_CASES = [
  {
    name: "a wrong method on the exact route",
    method: "GET",
    path: "/v1/feedback/inboxes/feedback_key_private/issues",
    expectedRoute: FEEDBACK_SUBMIT_ROUTE,
  },
  {
    name: "a trailing slash",
    method: "POST",
    path: "/v1/feedback/inboxes/feedback_key_private/issues/",
    expectedRoute: FEEDBACK_INBOX_LOG_ROUTE,
  },
  {
    name: "invalid percent encoding",
    method: "POST",
    path: "/v1/feedback/inboxes/feedback_key_%E0%A4%A/issues",
    expectedRoute: FEEDBACK_SUBMIT_ROUTE,
  },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("anonymous Feedback submit route boundary", () => {
  it("matches only the exact Feedback issue POST route", () => {
    expect(
      parseAnonymousFeedbackSubmitRoute(
        new Request(`http://local${FEEDBACK_ROUTE}?source=test`, {
          method: "POST",
        })
      )
    ).toEqual({ inboxKey: INBOX_KEY });

    const denied = [
      new Request(`http://local${FEEDBACK_ROUTE}`),
      new Request(`http://local${FEEDBACK_ROUTE}/retry`, { method: "POST" }),
      new Request("http://local/v1/feedback/inboxes/issues", {
        method: "POST",
      }),
      new Request("http://local/v1/feedback/issues", { method: "POST" }),
    ];
    for (const request of denied) {
      expect(parseAnonymousFeedbackSubmitRoute(request)).toBeNull();
    }
  });
});

describe("Feedback route log redaction", () => {
  it.each(
    FEEDBACK_LOG_REDACTION_CASES
  )("redacts $name without widening anonymous auth", ({
    expectedRoute,
    method,
    path,
  }) => {
    const request = new Request(`http://local${path}`, { method });

    expect(redactFeedbackRouteForLogging(request)).toBe(expectedRoute);
    expect(redactFeedbackRouteForLogging(request)).not.toContain(
      "feedback_key_"
    );
    expect(parseAnonymousFeedbackSubmitRoute(request)).toBeNull();
  });

  it("leaves unrelated routes outside the Feedback redaction family", () => {
    expect(
      redactFeedbackRouteForLogging(
        new Request("http://local/v1/spaces/demo/signals")
      )
    ).toBeNull();
  });

  it.each(
    FEEDBACK_LOG_REDACTION_CASES
  )("redacts $name from real auth rejection logs", async ({
    expectedRoute,
    method,
    path,
  }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env } = makeEnv({
      combinedAuthResult: createUnauthenticatedCombinedResult(),
    });

    const response = await app.fetch(
      new Request(`http://local${path}`, { method }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    expect(warn).toHaveBeenCalledWith(
      "[gateway.auth.rejected]",
      expect.objectContaining({ route: expectedRoute })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("feedback_key_");
  });
});

describe("Cloudflare Feedback submit rate limiter", () => {
  it("keeps the server-side limits at 10 per IP and 120 per inbox per minute", () => {
    expect(FEEDBACK_SUBMIT_RATE_LIMITS).toEqual({
      ip: { limit: 10, periodSeconds: 60 },
      inbox: { limit: 120, periodSeconds: 60 },
    });
  });

  it("consumes the IP and inbox dimensions with distinct keys", async () => {
    const ip = createRateLimitBinding();
    const inbox = createRateLimitBinding();
    const limiter = createCloudflareFeedbackSubmitRateLimiter({
      ip: ip.binding,
      inbox: inbox.binding,
    });

    await expect(
      limiter.check({ ipAddress: "203.0.113.7", inboxKey: INBOX_KEY })
    ).resolves.toEqual({ allowed: true, rejectedDimension: null });
    expect(ip.limit).toHaveBeenCalledWith({ key: "ip:203.0.113.7" });
    expect(inbox.limit).toHaveBeenCalledWith({
      key: `inbox:${INBOX_KEY}`,
    });
  });

  it.each([
    { dimension: "ip" as const, ipOutcomes: [false], inboxOutcomes: [true] },
    {
      dimension: "inbox" as const,
      ipOutcomes: [true],
      inboxOutcomes: [false],
    },
  ])("reports a rejected $dimension dimension", async ({
    dimension,
    ipOutcomes,
    inboxOutcomes,
  }) => {
    const ip = createRateLimitBinding(ipOutcomes);
    const inbox = createRateLimitBinding(inboxOutcomes);
    const limiter = createCloudflareFeedbackSubmitRateLimiter({
      ip: ip.binding,
      inbox: inbox.binding,
    });

    const result: FeedbackSubmitRateLimitResult = await limiter.check({
      ipAddress: "203.0.113.7",
      inboxKey: INBOX_KEY,
    });
    expect(result).toEqual({
      allowed: false,
      rejectedDimension: dimension,
    });
    expect(inbox.limit).toHaveBeenCalledTimes(dimension === "inbox" ? 1 : 0);
  });
});

describe("Feedback issue HTTP submission", () => {
  it("accepts a submission without credentials as anonymous and preserves the public request ID", async () => {
    const { env, coreRpc, authRpc, ipRateLimit, inboxRateLimit } = makeEnv();

    const response = await submitFeedback(env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      issueId: "feedback_issue_test",
    });
    expect(response.headers.get("x-openmeld-request-id")).toBe("req-feedback");
    expect(coreRpc.submitFeedbackIssue).toHaveBeenCalledWith({
      inboxKey: INBOX_KEY,
      request: VALID_PAYLOAD,
      submitterUserId: null,
    });
    expect(authRpc.resolveRequestAuth).not.toHaveBeenCalled();
    expect(authRpc.resolveRequestAuthWithProfile).not.toHaveBeenCalled();
    expect(ipRateLimit.limit).toHaveBeenCalledTimes(1);
    expect(inboxRateLimit.limit).toHaveBeenCalledTimes(1);
  });

  it("attaches a valid optional cookie-session principal", async () => {
    const { env, coreRpc, authRpc } = makeEnv({
      optionalAuthResult: {
        ok: true,
        claims: {
          authenticated: true,
          requestId: "req-feedback",
          callerPrincipalId: "user_cookie_feedback",
          ownerIds: ["user_cookie_feedback"],
          authMethod: "session",
        },
      },
    });

    const response = await submitFeedback(env, {
      cookie: "better-auth.session_token=valid-private-session",
    });

    expect(response.status).toBe(200);
    expect(coreRpc.submitFeedbackIssue).toHaveBeenCalledWith(
      expect.objectContaining({ submitterUserId: "user_cookie_feedback" })
    );
    expect(authRpc.resolveRequestAuth).toHaveBeenCalledTimes(1);
    expect(authRpc.resolveRequestAuthWithProfile).not.toHaveBeenCalled();
    expect(authRpc.resolveProfile).not.toHaveBeenCalled();
  });

  it("treats an invalid cookie session as anonymous", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env, coreRpc, authRpc } = makeEnv({
      optionalAuthResult: {
        ok: false,
        code: "auth.unauthenticated",
        message: "authentication required",
      },
    });

    const response = await submitFeedback(env, {
      cookie: "better-auth.session_token=expired-private-session",
    });

    expect(response.status).toBe(200);
    expect(coreRpc.submitFeedbackIssue).toHaveBeenCalledWith(
      expect.objectContaining({ submitterUserId: null })
    );
    expect(authRpc.resolveRequestAuth).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "expired-private-session"
    );
  });

  it("attaches a valid optional Bearer principal without resolving a profile", async () => {
    const { env, coreRpc, authRpc } = makeEnv({
      optionalAuthResult: {
        ok: true,
        claims: {
          authenticated: true,
          requestId: "req-feedback",
          callerPrincipalId: "user_feedback",
          ownerIds: ["user_feedback"],
          authMethod: "api_key",
        },
      },
    });

    const response = await submitFeedback(env, {
      authorization: "Bearer valid-feedback-token",
    });

    expect(response.status).toBe(200);
    expect(coreRpc.submitFeedbackIssue).toHaveBeenCalledWith(
      expect.objectContaining({ submitterUserId: "user_feedback" })
    );
    expect(authRpc.resolveRequestAuth).toHaveBeenCalledTimes(1);
    expect(authRpc.resolveRequestAuthWithProfile).not.toHaveBeenCalled();
    expect(authRpc.resolveProfile).not.toHaveBeenCalled();
  });

  it("treats an invalid Bearer as anonymous and logs no credential value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env, coreRpc } = makeEnv({
      optionalAuthResult: {
        ok: false,
        code: "auth.unauthenticated",
        message: "authentication required",
      },
    });

    const response = await submitFeedback(env, {
      authorization: "Bearer expired-private-token",
    });

    expect(response.status).toBe(200);
    expect(coreRpc.submitFeedbackIssue).toHaveBeenCalledWith(
      expect.objectContaining({ submitterUserId: null })
    );
    expect(warn).toHaveBeenCalledWith(
      "[gateway.feedback.optional_auth_ignored]",
      expect.objectContaining({
        event: "gateway.feedback.optional_auth_ignored",
        authorizationPresent: true,
        reasonCode: "auth.unauthenticated",
        requestId: "req-feedback",
      })
    );
    const serializedLogs = JSON.stringify(warn.mock.calls);
    expect(serializedLogs).not.toContain("expired-private-token");
    expect(serializedLogs).not.toContain(INBOX_KEY);
  });

  it("fails closed when optional authentication is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { env, coreRpc } = makeEnv({
      optionalAuthError: new Error("Auth RPC unavailable"),
    });

    const response = await submitFeedback(env, {
      authorization: "Bearer valid-but-unverifiable-token",
    });

    expect(response.status).toBe(502);
    await expect(readErrorCode(response)).resolves.toBe("upstream_unreachable");
    expect(coreRpc.submitFeedbackIssue).not.toHaveBeenCalled();
    expect(
      JSON.stringify([...warn.mock.calls, ...info.mock.calls])
    ).not.toContain(INBOX_KEY);
  });

  it("fails closed when authenticated claims omit the submitter principal", async () => {
    const { env, coreRpc } = makeEnv({
      optionalAuthResult: {
        ok: true,
        claims: {
          authenticated: true,
          requestId: "req-feedback",
          ownerIds: [],
          authMethod: "api_key",
        },
      },
    });

    const response = await submitFeedback(env, {
      authorization: "Bearer valid-feedback-token",
    });

    expect(response.status).toBe(502);
    await expect(readErrorCode(response)).resolves.toBe("upstream_unreachable");
    expect(coreRpc.submitFeedbackIssue).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "an extra field",
      payload: { ...VALID_PAYLOAD, attachmentUrl: "https://example.com/file" },
    },
    {
      name: "an overlong summary",
      payload: { ...VALID_PAYLOAD, summary: "x".repeat(201) },
    },
    {
      name: "an unknown category",
      payload: { ...VALID_PAYLOAD, category: "support" },
    },
  ])("rejects $name as Feedback invalid_input", async ({ payload }) => {
    const { env, coreRpc } = makeEnv();

    const response = await submitFeedback(env, { payload });

    expect(response.status).toBe(400);
    await expect(readErrorCode(response)).resolves.toBe(
      "feedback.submit.invalid_input"
    );
    expect(coreRpc.submitFeedbackIssue).not.toHaveBeenCalled();
  });

  it("maps malformed JSON to Feedback invalid_input", async () => {
    const { env, coreRpc } = makeEnv();
    const response = await app.fetch(
      new Request(`http://local${FEEDBACK_ROUTE}`, {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.7",
          "content-type": "application/json",
          "x-openmeld-request-id": "req-feedback",
        },
        body: "{",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(readErrorCode(response)).resolves.toBe(
      "feedback.submit.invalid_input"
    );
    expect(coreRpc.submitFeedbackIssue).not.toHaveBeenCalled();
  });

  it.each([
    {
      code: "feedback.submit.inbox_not_found",
      message: "feedback inbox was not found",
      status: 404,
    },
    {
      code: "feedback.submit.disabled",
      message: "feedback submission is disabled",
      status: 403,
    },
  ])("surfaces $code from Core", async ({ code, message, status }) => {
    const { env } = makeEnv({ coreError: { code, message, status } });

    const response = await submitFeedback(env);

    expect(response.status).toBe(status);
    await expect(readErrorCode(response)).resolves.toBe(code);
  });

  it("returns Feedback rate_limited when either server-side limiter rejects", async () => {
    const { env, coreRpc } = makeEnv({ ipRateLimitOutcomes: [false] });

    const response = await submitFeedback(env);

    expect(response.status).toBe(429);
    await expect(readErrorCode(response)).resolves.toBe(
      "feedback.submit.rate_limited"
    );
    expect(coreRpc.submitFeedbackIssue).not.toHaveBeenCalled();
  });

  it("keeps unrelated POST routes authenticated", async () => {
    const spaceId = "a".repeat(64);
    const { env } = makeEnv({
      combinedAuthResult: createUnauthenticatedCombinedResult({
        requestId: "req-other-post",
      }),
    });

    const responses = await Promise.all([
      app.fetch(
        new Request(`http://local/v1/spaces/${spaceId}/signals`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "hello" }),
        }),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        new Request(`http://local/v1/spaces/${spaceId}/members`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profileIds: [] }),
        }),
        env,
        TEST_EXECUTION_CONTEXT
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401]);
  });

  it("does not expose Feedback list or update HTTP routes", async () => {
    const { env, coreRpc } = makeEnv();
    const responses = await Promise.all([
      app.fetch(
        new Request("http://local/v1/feedback/issues", {
          headers: { Authorization: "Bearer valid-token" },
        }),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        new Request("http://local/v1/feedback/issues/feedback_issue_test", {
          method: "PATCH",
          headers: {
            Authorization: "Bearer valid-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: "resolved" }),
        }),
        env,
        TEST_EXECUTION_CONTEXT
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404]);
    expect(coreRpc).not.toHaveProperty("listFeedbackIssues");
    expect(coreRpc).not.toHaveProperty("updateFeedbackIssueStatus");
  });
});

function createRateLimitBinding(outcomes: boolean[] = []) {
  const queue = [...outcomes];
  const limit = vi.fn(
    async (_options: RateLimitOptions): Promise<RateLimitOutcome> => ({
      success: queue.shift() ?? true,
    })
  );
  return {
    binding: { limit } satisfies RateLimit,
    limit,
  };
}

function makeEnv(
  input: {
    combinedAuthResult?: unknown;
    coreError?: { code: string; message: string; status: number };
    inboxRateLimitOutcomes?: boolean[];
    ipRateLimitOutcomes?: boolean[];
    optionalAuthError?: Error;
    optionalAuthResult?: unknown;
  } = {}
) {
  const coreError = input.coreError;
  const coreRpc = {
    submitFeedbackIssue: coreError
      ? vi.fn(() => Promise.reject(createStructuredError(coreError)))
      : vi.fn(() =>
          Promise.resolve({
            ok: true as const,
            issueId: "feedback_issue_test",
          })
        ),
  };
  const authRpc = {
    resolveRequestAuth: vi.fn(() => {
      if (input.optionalAuthError) {
        throw input.optionalAuthError;
      }
      return input.optionalAuthResult === undefined
        ? {
            ok: true,
            claims: {
              authenticated: false,
              requestId: "req-feedback",
              ownerIds: [],
              authMethod: "none",
            },
          }
        : input.optionalAuthResult;
    }),
    resolveRequestAuthWithProfile: vi.fn(async () =>
      input.combinedAuthResult === undefined
        ? createAuthenticatedCombinedResult()
        : input.combinedAuthResult
    ),
    resolveProfile: vi.fn(async () => createAuthenticatedProfileResult()),
  };
  const ipRateLimit = createRateLimitBinding(input.ipRateLimitOutcomes);
  const inboxRateLimit = createRateLimitBinding(input.inboxRateLimitOutcomes);
  const env = {
    OPENMELD_AUTH_WORKER: authRpc,
    OPENMELD_CORE_WORKER: coreRpc,
    OPENMELD_FEEDBACK_IP_RATE_LIMITER: ipRateLimit.binding,
    OPENMELD_FEEDBACK_INBOX_RATE_LIMITER: inboxRateLimit.binding,
  } as unknown as CloudflareBindings;

  return { env, coreRpc, authRpc, ipRateLimit, inboxRateLimit };
}

async function submitFeedback(
  env: CloudflareBindings,
  input: {
    authorization?: string;
    cookie?: string;
    payload?: unknown;
  } = {}
): Promise<Response> {
  return await app.fetch(
    new Request(`http://local${FEEDBACK_ROUTE}`, {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "203.0.113.7",
        "content-type": "application/json",
        "x-openmeld-request-id": "req-feedback",
        ...(input.authorization ? { Authorization: input.authorization } : {}),
        ...(input.cookie ? { Cookie: input.cookie } : {}),
      },
      body: JSON.stringify(input.payload ?? VALID_PAYLOAD),
    }),
    env,
    TEST_EXECUTION_CONTEXT
  );
}

function createStructuredError(input: {
  code: string;
  message: string;
  status: number;
}): Error {
  const error = new Error(input.message) as Error & { cause?: unknown };
  error.cause = input;
  return error;
}

function createAuthenticatedCombinedResult() {
  return {
    ok: true,
    claims: {
      authenticated: true,
      requestId: "req-authenticated",
      callerPrincipalId: "user_feedback",
      profileId: "11111111-1111-4111-8111-111111111111",
      profileKind: "human",
      ownerIds: ["user_feedback"],
      authMethod: "api_key",
    },
    profile: createAuthenticatedProfileResult(),
  };
}

function createUnauthenticatedCombinedResult(
  input: { requestId?: string } = {}
) {
  return {
    ok: true,
    claims: {
      authenticated: false,
      requestId: input.requestId ?? "req-feedback-rejected",
      ownerIds: [],
      authMethod: "none",
    },
  };
}

function createAuthenticatedProfileResult() {
  return {
    ok: true,
    resolvedProfile: {
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Mira",
      profileKind: "human",
      ownerUserId: "user_feedback",
    },
  };
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}
