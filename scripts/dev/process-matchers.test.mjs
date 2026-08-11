import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProcessMatcherContext,
  isDevGuardCommand,
  isRepoProcessCommand,
  isTurboDevCommand,
  isWebViteDevCommand,
  isWranglerDevCommand,
  isWranglerWorkerdCommand,
  normalizeProcessMatchText,
} from "./process-matchers.mjs";

test("normalizes backslashes for Windows process matching", () => {
  assert.equal(
    normalizeProcessMatchText("C:\\repo\\services\\core\\wrangler.jsonc"),
    "C:/repo/services/core/wrangler.jsonc"
  );
});

test("matches Windows wrangler dev commands in repo service paths", () => {
  const matcherContext = buildProcessMatcherContext("C:\\repo");
  const normalizedCommand = normalizeProcessMatchText(
    "node C:\\repo\\node_modules\\wrangler\\bin\\wrangler.js dev --config C:\\repo\\services\\core\\wrangler.jsonc"
  );

  assert.equal(isRepoProcessCommand(normalizedCommand, matcherContext), true);
  assert.equal(isWranglerDevCommand(normalizedCommand, matcherContext), true);
});

test("does not match sibling paths that only share the repo path prefix", () => {
  const matcherContext = buildProcessMatcherContext("/repo");
  const normalizedCommand = normalizeProcessMatchText(
    "node /repo-copy/node_modules/.bin/turbo run dev --filter=!openmeld-web"
  );

  assert.equal(isRepoProcessCommand(normalizedCommand, matcherContext), false);
});

test("matches repo wrangler launcher commands without a service path", () => {
  const matcherContext = buildProcessMatcherContext("C:\\repo");
  const normalizedCommand = normalizeProcessMatchText(
    "node C:\\repo\\node_modules\\.pnpm\\wrangler@4.70.0\\node_modules\\wrangler\\wrangler-dist\\cli.js dev"
  );

  assert.equal(isWranglerDevCommand(normalizedCommand, matcherContext), true);
});

test("matches Windows dev-guard script path", () => {
  const matcherContext = buildProcessMatcherContext("C:\\repo");
  const normalizedCommand = normalizeProcessMatchText(
    "node C:\\repo\\scripts\\dev\\dev-guard.mjs"
  );

  assert.equal(isDevGuardCommand(normalizedCommand, matcherContext), true);
});

test("matches Windows workerd.exe local worker commands", () => {
  const matcherContext = buildProcessMatcherContext("C:\\repo");
  const normalizedCommand = normalizeProcessMatchText(
    "C:\\repo\\node_modules\\@cloudflare\\workerd-win32-64\\bin\\workerd.exe serve --socket-addr=entry=localhost:8787"
  );

  assert.equal(
    isWranglerWorkerdCommand(normalizedCommand, matcherContext),
    true
  );
});

test("matches loopback workerd commands that use 127.0.0.1 and external loopback addresses", () => {
  const matcherContext = buildProcessMatcherContext("/repo");
  const normalizedCommand = normalizeProcessMatchText(
    "/repo/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd serve --socket-addr=entry=127.0.0.1:0 --external-addr=loopback=127.0.0.1:59058 --control-fd=3 -"
  );

  assert.equal(
    isWranglerWorkerdCommand(normalizedCommand, matcherContext),
    true
  );
});

test("does not match wrangler dev commands outside OpenMeld services", () => {
  const matcherContext = buildProcessMatcherContext("C:\\repo");
  const normalizedCommand = normalizeProcessMatchText(
    "node C:\\repo\\node_modules\\wrangler\\bin\\wrangler.js dev --config C:\\repo\\clients\\web\\wrangler.jsonc"
  );

  assert.equal(isWranglerDevCommand(normalizedCommand, matcherContext), false);
});

test("matches clients/web Vite dev commands on the standard local port", () => {
  const matcherContext = buildProcessMatcherContext("C:\\repo");
  const normalizedCommand = normalizeProcessMatchText(
    "node C:\\repo\\clients\\web\\node_modules\\.bin\\..\\vite\\bin\\vite.js dev --port 3000"
  );

  assert.equal(isWebViteDevCommand(normalizedCommand, matcherContext), true);
});

test("does not match Vite dev commands outside clients/web", () => {
  const matcherContext = buildProcessMatcherContext("C:\\repo");
  const normalizedCommand = normalizeProcessMatchText(
    "node C:\\repo\\sandbox\\web\\node_modules\\.bin\\..\\vite\\bin\\vite.js dev --port 3000"
  );

  assert.equal(isWebViteDevCommand(normalizedCommand, matcherContext), false);
});

test("keeps existing POSIX turbo matching behavior", () => {
  const normalizedCommand = normalizeProcessMatchText(
    "node /repo/node_modules/.bin/turbo run dev --filter=!openmeld-web --concurrency=11"
  );

  assert.equal(isTurboDevCommand(normalizedCommand), true);
});
