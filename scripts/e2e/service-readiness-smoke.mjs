#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 30_000;
const LINE_SPLIT_PATTERN = /\n+/;

export function parseAuthSessionState(stdout) {
  const sessionRecord = parseJsonLines(stdout).find(
    (record) => record?.code === "auth.status.session"
  );
  const state = sessionRecord?.payload?.state;
  return typeof state === "string" ? state : null;
}

export function parseServiceStatusPayload(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("service status produced no JSON output");
  }
  const lines = trimmed
    .split(LINE_SPLIT_PATTERN)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(
      `service status expected one JSON object, received ${lines.length}`
    );
  }
  return JSON.parse(lines[0]);
}

export function analyzeServiceStatusPayload(payload, options = {}) {
  const failures = [];
  if (payload?.type !== "daemon.status") {
    failures.push("service status payload type is not daemon.status");
  }
  if (payload?.localResult?.statusScope !== "local_service") {
    failures.push("local service status scope is missing");
  }
  if (payload?.localResult?.installed !== true) {
    failures.push("OpenMeld Service is not installed in this lane");
  }
  const runtimeStatus = payload?.localResult?.runtime?.status ?? null;
  if (runtimeStatus !== "running") {
    failures.push(
      `OpenMeld Service runtime is not running (status=${String(runtimeStatus)})`
    );
  }
  if (!payload?.localResult?.environmentTarget) {
    failures.push("environment target is missing from local service status");
  }
  if (!payload?.result?.daemonRouteObservation) {
    failures.push("daemon route observation is missing");
  }
  if (!payload?.result?.diagnostics?.localServiceDiagnostics) {
    failures.push("local service readiness diagnostics are missing");
  }
  if (!Object.hasOwn(payload ?? {}, "runtimeProjection")) {
    failures.push("runtime projection field is missing");
  }

  const routeStatus = payload?.result?.daemonRouteObservation?.status ?? null;
  if (options.requireOnlineRoute === true && routeStatus !== "online") {
    failures.push(
      `daemon route observation is not online (status=${String(routeStatus)})`
    );
  }

  return {
    failures,
    summary: {
      installed: payload?.localResult?.installed === true,
      runtimeStatus,
      routeReasonCode:
        payload?.result?.daemonRouteObservation?.reasonCode ?? null,
      routeStatus,
    },
  };
}

function parseJsonLines(stdout) {
  return stdout
    .split(LINE_SPLIT_PATTERN)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function parseArgs(argv, env) {
  const options = {
    cli: env.OPENMELD_SMOKE_CLI || "openmeld",
    profile: env.OPENMELD_SMOKE_PROFILE || null,
    requireOnlineRoute: env.OPENMELD_SMOKE_REQUIRE_ONLINE_ROUTE === "1",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--cli") {
      options.cli = requireValue(argv, index, "--cli");
      index += 1;
    } else if (arg === "--profile") {
      options.profile = requireValue(argv, index, "--profile");
      index += 1;
    } else if (arg === "--require-online-route") {
      options.requireOnlineRoute = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage:
  node scripts/e2e/service-readiness-smoke.mjs [--profile <id-or-name>] [--require-online-route] [--cli <executable>]

Environment:
  OPENMELD_SMOKE_CLI                     CLI executable to run, defaults to openmeld.
  OPENMELD_SMOKE_PROFILE                 Optional profile id/name for route observation.
  OPENMELD_SMOKE_REQUIRE_ONLINE_ROUTE=1  Fail unless daemonRouteObservation.status is online.

This smoke is read-only. It runs auth status and service status --json.`);
}

function runCli(options, args) {
  const result = spawnSync(options.cli, args, {
    encoding: "utf8",
    env: process.env,
    shell: false,
    timeout: DEFAULT_TIMEOUT_MS,
  });
  return {
    command: formatCommandDisplay(options.cli, args),
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

function formatCommandDisplay(executable, args) {
  return [executable, ...args].map((value) => JSON.stringify(value)).join(" ");
}

function fail(message, detail = "") {
  console.error(`FAIL ${message}`);
  if (detail.trim()) {
    console.error(detail.trim());
  }
  process.exit(1);
}

function main() {
  const options = parseArgs(process.argv.slice(2), process.env);

  const auth = runCli(options, ["--view", "agent", "auth", "status"]);
  if (auth.error) {
    fail("auth status command failed to start", auth.error.message);
  }
  if (auth.status !== 0) {
    fail("auth status command failed", auth.stderr || auth.stdout);
  }
  const authState = parseAuthSessionState(auth.stdout);
  if (authState !== "valid") {
    fail(
      "signed-in OpenMeld auth session is required",
      `auth_status=${String(authState)} command=${auth.command}`
    );
  }

  const serviceArgs = ["service", "status", "--json"];
  if (options.profile) {
    serviceArgs.push("--profile", options.profile);
  }
  const service = runCli(options, serviceArgs);
  if (service.error) {
    fail("service status command failed to start", service.error.message);
  }
  if (service.status !== 0) {
    fail("service status command failed", service.stderr || service.stdout);
  }

  let payload;
  try {
    payload = parseServiceStatusPayload(service.stdout);
  } catch (error) {
    fail(
      "service status JSON output is invalid",
      error instanceof Error ? error.message : String(error)
    );
  }

  const analysis = analyzeServiceStatusPayload(payload, {
    requireOnlineRoute: options.requireOnlineRoute,
  });
  if (analysis.failures.length > 0) {
    fail(
      "service readiness smoke failed",
      analysis.failures.map((failure) => `- ${failure}`).join("\n")
    );
  }

  console.log("PASS service readiness smoke");
  console.log(`cli=${options.cli}`);
  console.log(`installed=${String(analysis.summary.installed)}`);
  console.log(`runtime_status=${String(analysis.summary.runtimeStatus)}`);
  console.log(`route_status=${String(analysis.summary.routeStatus)}`);
  console.log(`route_reason=${String(analysis.summary.routeReasonCode)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
