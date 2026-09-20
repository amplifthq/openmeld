import assert from "node:assert/strict";
import test from "node:test";

import { collectTargetProcesses } from "./dev-stop.mjs";
import { buildProcessMatcherContext } from "./process-matchers.mjs";

test("stops isolated Vite and artifact servers without selecting another worktree", () => {
  const rows = [
    {
      pid: 1,
      command:
        "node /repo/a/clients/web/node_modules/.bin/../vite/bin/vite.js dev",
    },
    {
      pid: 2,
      command:
        "node /repo/a/scripts/dev/serve-cli-binary.mjs --absolute-entry --worktree",
    },
    {
      pid: 3,
      command:
        "node /repo/b/scripts/dev/serve-cli-binary.mjs --absolute-entry --worktree",
    },
    {
      pid: 4,
      command:
        "node /repo/b/clients/web/node_modules/.bin/../vite/bin/vite.js dev",
    },
  ];
  assert.deepEqual(
    collectTargetProcesses(rows, {
      matcherContext: buildProcessMatcherContext("/repo/a"),
      currentPid: 99,
    }).map((row) => row.pid),
    [1, 2]
  );
});

test("collects Windows coordinator and worker processes with normalized commands", () => {
  const matcherContext = buildProcessMatcherContext("C:\\repo");
  const rows = [
    { pid: 100, command: "node C:\\repo\\scripts\\dev\\dev-stop.mjs" },
    { pid: 200, command: "node C:\\repo\\scripts\\dev\\dev-guard.mjs" },
    {
      pid: 300,
      command:
        "node C:\\repo\\node_modules\\.bin\\turbo run dev --filter=!openmeld-web --filter=!@openmeld/desktop --concurrency=11",
    },
    {
      pid: 400,
      command:
        "node C:\\repo\\node_modules\\wrangler\\bin\\wrangler.js dev --config C:\\repo\\services\\auth\\wrangler.jsonc",
    },
    {
      pid: 450,
      command:
        "node C:\\repo\\node_modules\\.pnpm\\wrangler@4.70.0\\node_modules\\wrangler\\wrangler-dist\\cli.js dev",
    },
    {
      pid: 500,
      command:
        "C:\\repo\\node_modules\\@cloudflare\\workerd-win32-64\\bin\\workerd.exe serve --socket-addr=entry=127.0.0.1:0 --external-addr=loopback=127.0.0.1:59058 --control-fd=3 -",
    },
    {
      pid: 600,
      command:
        "node C:\\other\\node_modules\\wrangler\\bin\\wrangler.js dev --config C:\\other\\services\\core\\wrangler.jsonc",
    },
    {
      pid: 700,
      command:
        "node C:\\repo\\clients\\web\\node_modules\\.bin\\..\\vite\\bin\\vite.js dev --port 3000",
    },
    {
      pid: 800,
      command:
        "node C:\\other\\clients\\web\\node_modules\\.bin\\..\\vite\\bin\\vite.js dev --port 3000",
    },
  ];

  assert.deepEqual(
    collectTargetProcesses(rows, {
      currentPid: 100,
      matcherContext,
    }),
    [
      {
        pid: 200,
        command: "node C:\\repo\\scripts\\dev\\dev-guard.mjs",
        kind: "coordinator",
      },
      {
        pid: 300,
        command:
          "node C:\\repo\\node_modules\\.bin\\turbo run dev --filter=!openmeld-web --filter=!@openmeld/desktop --concurrency=11",
        kind: "coordinator",
      },
      {
        pid: 400,
        command:
          "node C:\\repo\\node_modules\\wrangler\\bin\\wrangler.js dev --config C:\\repo\\services\\auth\\wrangler.jsonc",
        kind: "worker",
      },
      {
        pid: 450,
        command:
          "node C:\\repo\\node_modules\\.pnpm\\wrangler@4.70.0\\node_modules\\wrangler\\wrangler-dist\\cli.js dev",
        kind: "worker",
      },
      {
        pid: 500,
        command:
          "C:\\repo\\node_modules\\@cloudflare\\workerd-win32-64\\bin\\workerd.exe serve --socket-addr=entry=127.0.0.1:0 --external-addr=loopback=127.0.0.1:59058 --control-fd=3 -",
        kind: "worker",
      },
      {
        pid: 700,
        command:
          "node C:\\repo\\clients\\web\\node_modules\\.bin\\..\\vite\\bin\\vite.js dev --port 3000",
        kind: "worker",
      },
    ]
  );
});
