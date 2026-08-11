import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDevStackGatewayChainFailure,
  LocalDevStackReadinessError,
  resolveDevStackTimeoutMs,
  waitForLocalDevStackReady,
} from "./dev-stack-readiness.mjs";

const MISSING_LOCAL_WORKER_SESSION_RE =
  /missing a required local Worker session/;
const GATEWAY_CHAIN_UNHEALTHY_RE = /gateway auth chain is unhealthy/;
const AUTH_ROOT_UNAVAILABLE_RE = /auth root is unavailable/;
const DEV_STACK_TIMEOUT_ENV_ERROR_RE =
  /OPENMELD_DEV_STACK_TIMEOUT_MS must be a positive integer/;
const AUTH_ROOT_UNREACHABLE_SUMMARY_RE = /auth root=unreachable/;
const GATEWAY_ROOT_HEALTHY_SUMMARY_RE = /gateway root=healthy/;
const GATEWAY_CHAIN_NOT_PROBED_SUMMARY_RE = /gateway auth chain=not probed/;
const READINESS_PROGRESS_RE = /waiting for local OpenMeld dev stack/;
const AUTH_ROOT_NOT_READY_RE = /auth root is not ready/;
const RECENT_AUTH_ROOT_UNREACHABLE_RE = /Recent probes: auth root=unreachable/;
const ISOLATED_RESTART_RE = /Restart `pnpm dev:isolated`/u;
const ISOLATED_CHAIN_URL_RE =
  /http:\/\/localhost:31001\/v1\/diagnostics\/chain/u;
const STANDARD_STOP_COMMAND_RE = /pnpm dev:stop/u;
const STANDARD_GATEWAY_PORT_RE = /localhost:8080/u;

test("classifies missing local dev sessions distinctly", () => {
  assert.equal(
    classifyDevStackGatewayChainFailure(
      'upstream_unreachable: Cannot access "resolveRequestAuth" as we couldn\'t find a local dev session for the "GatewayAuthRpcEntrypoint" entrypoint of service "openmeld-auth" to proxy to.'
    ),
    "local_dev_session_missing"
  );
  assert.equal(
    classifyDevStackGatewayChainFailure('Worker "openmeld-auth" not found'),
    "local_dev_session_missing"
  );
});

test("uses a longer default dev stack timeout and supports env override", () => {
  assert.equal(resolveDevStackTimeoutMs({ env: {} }), 180_000);
  assert.equal(
    resolveDevStackTimeoutMs({
      env: {
        OPENMELD_DEV_STACK_TIMEOUT_MS: "240000",
      },
    }),
    240_000
  );
  assert.throws(
    () =>
      resolveDevStackTimeoutMs({
        env: {
          OPENMELD_DEV_STACK_TIMEOUT_MS: "0",
        },
      }),
    DEV_STACK_TIMEOUT_ENV_ERROR_RE
  );
});

test("waits for auth, gateway, and chain probes to become healthy", async () => {
  const calls = [];
  const fetchImpl = (url) => {
    calls.push(String(url));
    if (String(url).includes("/v1/diagnostics/chain")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  };

  const readiness = await waitForLocalDevStackReady({
    fetchImpl,
    timeoutMs: 200,
    chainGracePeriodMs: 0,
  });

  assert.equal(
    readiness.summary,
    "auth, gateway, and gateway auth chain are healthy."
  );
  assert.ok(calls.includes("http://localhost:8788/"));
  assert.ok(calls.includes("http://localhost:8080/"));
  assert.ok(calls.includes("http://localhost:8080/v1/diagnostics/chain"));
});

test("probes the explicit isolated lane URLs instead of fixed default ports", async () => {
  const calls = [];
  const fetchImpl = (url) => {
    calls.push(String(url));
    if (String(url).includes("/v1/diagnostics/chain")) {
      return Promise.resolve(new Response("unauthorized", { status: 401 }));
    }
    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  await waitForLocalDevStackReady({
    authBaseUrl: "http://localhost:31002",
    gatewayBaseUrl: "http://localhost:31001/",
    fetchImpl,
    timeoutMs: 200,
    chainGracePeriodMs: 0,
  });

  assert.deepEqual(calls, [
    "http://localhost:31002/",
    "http://localhost:31001/",
    "http://localhost:31001/v1/diagnostics/chain",
  ]);
  assert.equal(
    calls.some((url) => url.includes("localhost:8788")),
    false
  );
  assert.equal(
    calls.some((url) => url.includes("localhost:8080")),
    false
  );
});

test("fails when the gateway auth chain still reports a missing local dev session", async () => {
  const fetchImpl = (url) => {
    if (String(url).includes("/v1/diagnostics/chain")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "upstream_unreachable",
              message:
                'Cannot access "resolveRequestAuth" as we couldn\'t find a local dev session for the "GatewayAuthRpcEntrypoint" entrypoint of service "openmeld-auth" to proxy to.',
            },
          }),
          {
            status: 502,
            headers: { "content-type": "application/json" },
          }
        )
      );
    }

    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  await assert.rejects(
    () =>
      waitForLocalDevStackReady({
        fetchImpl,
        timeoutMs: 20,
        chainGracePeriodMs: 0,
      }),
    MISSING_LOCAL_WORKER_SESSION_RE
  );
});

test("surfaces structured readiness details for missing local Worker sessions", async () => {
  const fetchImpl = (url) => {
    if (String(url).includes("/v1/diagnostics/chain")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "upstream_unreachable",
              message:
                'Cannot access "resolveRequestAuth" as we couldn\'t find a local dev session for the "GatewayAuthRpcEntrypoint" entrypoint of service "openmeld-auth" to proxy to.',
            },
          }),
          {
            status: 502,
            headers: { "content-type": "application/json" },
          }
        )
      );
    }

    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  await assert.rejects(
    () =>
      waitForLocalDevStackReady({
        fetchImpl,
        timeoutMs: 20,
        chainGracePeriodMs: 0,
      }),
    (error) => {
      assert.equal(error instanceof LocalDevStackReadinessError, true);
      assert.equal(error.targetKey, "gateway-chain");
      assert.equal(error.targetSummary, "gateway auth chain");
      assert.equal(
        error.targetUrl,
        "http://localhost:8080/v1/diagnostics/chain"
      );
      assert.equal(error.failure, "local_dev_session_missing");
      assert.equal(error.status, 502);
      assert.match(error.message, MISSING_LOCAL_WORKER_SESSION_RE);
      return true;
    }
  );
});

test("uses isolated restart guidance and the isolated chain URL", async () => {
  const fetchImpl = (url) => {
    if (String(url).includes("/v1/diagnostics/chain")) {
      return Promise.resolve(
        new Response('Worker "openmeld-auth" not found', { status: 502 })
      );
    }

    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  await assert.rejects(
    () =>
      waitForLocalDevStackReady({
        authBaseUrl: "http://localhost:31002",
        fetchImpl,
        gatewayBaseUrl: "http://localhost:31001",
        restartCommand: "pnpm dev:isolated",
        timeoutMs: 20,
        chainGracePeriodMs: 0,
      }),
    (error) => {
      assert.match(error.message, ISOLATED_RESTART_RE);
      assert.match(error.message, ISOLATED_CHAIN_URL_RE);
      assert.doesNotMatch(error.message, STANDARD_STOP_COMMAND_RE);
      assert.doesNotMatch(error.message, STANDARD_GATEWAY_PORT_RE);
      return true;
    }
  );
});

test("does not treat a 200 gateway-chain response as healthy", async () => {
  const fetchImpl = (url) => {
    if (String(url).includes("/v1/diagnostics/chain")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  await assert.rejects(
    () =>
      waitForLocalDevStackReady({
        fetchImpl,
        timeoutMs: 20,
        chainGracePeriodMs: 0,
      }),
    GATEWAY_CHAIN_UNHEALTHY_RE
  );
});

test("reports auth-root startup failures explicitly", async () => {
  const fetchImpl = (url) => {
    if (String(url) === "http://localhost:8788/") {
      return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:8788"));
    }
    if (String(url).includes("/v1/diagnostics/chain")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      );
    }
    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  await assert.rejects(
    () =>
      waitForLocalDevStackReady({
        fetchImpl,
        timeoutMs: 20,
        chainGracePeriodMs: 0,
      }),
    AUTH_ROOT_UNAVAILABLE_RE
  );
});

test("surfaces structured readiness details for auth-root startup failures", async () => {
  const fetchImpl = (url) => {
    if (String(url) === "http://localhost:8788/") {
      return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:8788"));
    }
    if (String(url).includes("/v1/diagnostics/chain")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      );
    }
    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  await assert.rejects(
    () =>
      waitForLocalDevStackReady({
        fetchImpl,
        timeoutMs: 20,
        chainGracePeriodMs: 0,
      }),
    (error) => {
      assert.equal(error instanceof LocalDevStackReadinessError, true);
      assert.equal(error.targetKey, "auth");
      assert.equal(error.targetSummary, "auth root");
      assert.equal(error.targetUrl, "http://localhost:8788/");
      assert.equal(error.failure, "target_unreachable");
      assert.equal(error.status, null);
      assert.equal(error.raw, "connect ECONNREFUSED 127.0.0.1:8788");
      assert.equal(error.timeoutMs, 20);
      assert.match(error.probeSummary, AUTH_ROOT_UNREACHABLE_SUMMARY_RE);
      assert.match(error.probeSummary, GATEWAY_ROOT_HEALTHY_SUMMARY_RE);
      assert.match(error.probeSummary, GATEWAY_CHAIN_NOT_PROBED_SUMMARY_RE);
      assert.match(error.message, AUTH_ROOT_UNAVAILABLE_RE);
      assert.match(error.message, RECENT_AUTH_ROOT_UNREACHABLE_RE);
      return true;
    }
  );
});

test("logs bounded readiness progress with recent probe state", async () => {
  const logs = [];
  const fetchImpl = (url) => {
    if (String(url) === "http://localhost:8788/") {
      return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:8788"));
    }
    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  await assert.rejects(() =>
    waitForLocalDevStackReady({
      fetchImpl,
      timeoutMs: 5,
      rootPollIntervalMs: 1,
      progressIntervalMs: 1,
      logger: {
        log(message) {
          logs.push(String(message));
        },
      },
    })
  );

  assert.ok(logs.length > 0);
  assert.match(logs[0], READINESS_PROGRESS_RE);
  assert.match(logs[0], AUTH_ROOT_NOT_READY_RE);
  assert.match(logs[0], RECENT_AUTH_ROOT_UNREACHABLE_RE);
});

test("surfaces structured readiness details for unhealthy gateway chains", async () => {
  const fetchImpl = (url) => {
    if (String(url).includes("/v1/diagnostics/chain")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  await assert.rejects(
    () =>
      waitForLocalDevStackReady({
        fetchImpl,
        timeoutMs: 20,
        chainGracePeriodMs: 0,
      }),
    (error) => {
      assert.equal(error instanceof LocalDevStackReadinessError, true);
      assert.equal(error.targetKey, "gateway-chain");
      assert.equal(error.failure, "chain_unhealthy_unknown");
      assert.equal(error.status, 200);
      assert.match(error.message, GATEWAY_CHAIN_UNHEALTHY_RE);
      return true;
    }
  );
});

test("does not probe the gateway auth chain before auth and gateway roots are healthy", async () => {
  const calls = [];
  let authAttempts = 0;
  const fetchImpl = (url) => {
    const normalizedUrl = String(url);
    calls.push(normalizedUrl);

    if (normalizedUrl === "http://localhost:8788/") {
      authAttempts += 1;
      if (authAttempts === 1) {
        return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:8788"));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    }

    if (normalizedUrl === "http://localhost:8080/") {
      return Promise.resolve(new Response("ok", { status: 200 }));
    }

    if (normalizedUrl.includes("/v1/diagnostics/chain")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      );
    }

    throw new Error(`unexpected probe url: ${normalizedUrl}`);
  };

  await waitForLocalDevStackReady({
    fetchImpl,
    timeoutMs: 200,
    rootPollIntervalMs: 1,
    chainPollIntervalMs: 1,
    chainGracePeriodMs: 0,
  });

  assert.deepEqual(calls.slice(0, 2), [
    "http://localhost:8788/",
    "http://localhost:8080/",
  ]);
  assert.equal(
    calls.filter((call) => call.includes("/v1/diagnostics/chain")).length,
    1
  );
});
