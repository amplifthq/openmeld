import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planPrChecks,
  resolveUnitTestScript,
  runPrChecks,
} from "./verify-pr.mjs";

const CIRCULAR_ALIAS = /Circular test script alias/u;

test("checks signed Skill inputs in feedback and PR validation without checking unrelated edits", () => {
  for (const feedback of [true, false]) {
    for (const [path, selected] of [
      ["release/openmeld-cli-skill/playbooks/agent-onboarding.md", true],
      ["clients/web/public/skills/openmeld-cli/channel.json", true],
      ["scripts/release/cli-skill.mjs", true],
      ["scripts/release/cli-skill-check.mjs", true],
      ["packages/schemas/src/official-cli-skill.ts", true],
      ["packages/schemas/src/index.ts", true],
      ["pnpm-lock.yaml", true],
      ["clients/web/src/sidebar.tsx", false],
      ["developing/engineering/official-cli-skill.md", false],
    ]) {
      const commands = planPrChecks([path], { feedback });
      assert.equal(
        commands.some((args) => args.join(" ") === "run verify:cli-skill"),
        selected,
        path
      );
    }
  }
});

test("focused PR validation keeps checks for changed workspaces with adjacent tests", () => {
  const paths = [
    "scripts/dev/verify-pr.test.mjs",
    "clients/web/src/app.tsx",
    "clients/openmeld-cli/src/commands/service.ts",
    "clients/desktop/src/deleted.ts",
  ];
  const existingFiles = [
    ...paths.slice(0, 3),
    "clients/web/src/app.test.tsx",
    "clients/openmeld-cli/src/commands/service.test.ts",
  ];
  const workspaces = [
    { directory: "clients/web", name: "openmeld-web", test: "vitest run" },
    { directory: "clients/openmeld-cli", name: "openmeld", test: "vitest run" },
    {
      directory: "clients/desktop",
      name: "@openmeld/desktop",
      test: "vitest run",
    },
  ];
  const commands = planPrChecks(paths, {
    feedback: true,
    existingFiles,
    workspaces,
  });
  assert.ok(
    commands.some((args) => args.includes("scripts/dev/verify-pr.test.mjs"))
  );
  assert.ok(commands.some((args) => args.includes("biome")));
  assert.ok(
    commands.some((args) => args.includes("--filter=openmeld-web^..."))
  );
  assert.ok(commands.some((args) => args.includes("--filter=openmeld^...")));
  assert.deepEqual(
    commands
      .filter((args) =>
        args.includes("scripts/dev/run-focused-workspace-tests.mjs")
      )
      .map((args) => args[3]),
    ["clients/web", "clients/openmeld-cli"]
  );
  assert.ok(commands.every((args) => !args.includes("related")));
  assert.ok(
    commands.every((args) => !args.some((arg) => arg.startsWith("--shard=")))
  );
});

test("Core feedback delegates every selected file to the package-owned runner contracts", () => {
  const paths = [
    "services/core/tests-node/local-contract.test.ts",
    "services/core/tests-split-gate/dispatch-queue-hot-path.split-routing.test.ts",
    "services/core/tests/remote-agent-routine-delivery.integration.test.ts",
  ];
  const commands = planPrChecks(paths, {
    feedback: true,
    existingFiles: paths,
    workspaces: [
      {
        directory: "services/core",
        name: "@openmeld/core",
        test: "vitest run --config vitest.boundary.config.ts",
      },
    ],
  });
  assert.deepEqual(
    commands
      .find((args) =>
        args.includes("scripts/dev/run-focused-workspace-tests.mjs")
      )
      .slice(5),
    paths.map((file) => file.slice("services/core/".length))
  );
});
test("Worker changes select the existing Zod contract guard before expensive tests", () => {
  for (const feedback of [true, false]) {
    for (const file of [
      "services/remote-agent/agent-core/session-title.ts",
      "services/core/src/index.ts",
      "packages/schemas/src/index.ts",
      "scripts/cloudflare/worker-zod-import-contract.mjs",
    ]) {
      assert.deepEqual(planPrChecks([file], { feedback })[0], [
        "run",
        "verify:worker-zod-imports",
      ]);
    }
    for (const file of [
      "clients/web/src/index.tsx",
      "developing/README.md",
      "services/core/README.md",
    ]) {
      assert.ok(
        !planPrChecks([file], { feedback }).some((args) =>
          args.includes("verify:worker-zod-imports")
        )
      );
    }
  }
});

test("focused checks changed files and adjacent tests without package builds", () => {
  const sources = [
    "clients/web/src/sidebar.tsx",
    "clients/web/src/sidebar.test.tsx",
  ];
  const commands = planPrChecks(sources, {
    feedback: true,
    existingFiles: sources,
    workspaces: [
      {
        directory: "clients/web",
        test: "vitest run --config vitest.config.ts",
      },
    ],
  });
  assert.deepEqual(commands, [
    ["exec", "biome", "check", "--no-errors-on-unmatched", "--", ...sources],
    [
      "exec",
      "node",
      "scripts/dev/run-focused-workspace-tests.mjs",
      "clients/web",
      "vitest run --config vitest.config.ts",
      "src/sidebar.test.tsx",
    ],
  ]);
  assert.ok(
    commands.every((args) => !args.includes("scripts/dev/turbo-affected.mjs"))
  );
});

test("deleted files never turn a focused lint command into a repository scan", () => {
  assert.deepEqual(
    planPrChecks(["clients/web/src/deleted.ts"], {
      feedback: true,
      existingFiles: [],
    }),
    []
  );
});

test("focused control checks run the owning Node regression tests once", () => {
  const commands = planPrChecks(
    ["scripts/dev/verify-pr.mjs", "scripts/dev/verify-pr.test.mjs"],
    {
      feedback: true,
    }
  );
  assert.deepEqual(commands.at(-1), [
    "exec",
    "node",
    "--test",
    "--test-concurrency=1",
    "scripts/dev/verify-pr.test.mjs",
  ]);
  assert.ok(
    commands.every((args) => !args.includes("verify:release-workflows"))
  );
});

test("docs-only focused checks avoid code, test discovery, and builds", () => {
  assert.deepEqual(planPrChecks(["developing/README.md"], { feedback: true }), [
    ["run", "verify:docs", "--", "--strict"],
  ]);
});

test("focused feedback leaves non-Vitest package tests to the agent", () => {
  const commands = planPrChecks(["services/core/src/index.ts"], {
    feedback: true,
    workspaces: [
      { directory: "services/core", test: "pnpm run test:boundary" },
    ],
  });
  assert.equal(commands.length, 2);
  assert.ok(commands[1].includes("biome"));
});

test("documentation and shared skill edits avoid workspace builds and tests", () => {
  assert.deepEqual(
    planPrChecks([
      "developing/engineering/development-workflow.md",
      ".agents/skills/writing-tests/SKILL.md",
    ]),
    [["run", "verify:docs", "--", "--strict"]]
  );
});

test("CI controls select their root tests outside the workspace graph", () => {
  assert.ok(
    planPrChecks(["scripts/ci/final-candidate-policy.mjs"]).some((args) =>
      args.includes("verify:release-workflows")
    )
  );
});

test("shared contracts and SQL migrations retain downstream validation", () => {
  for (const file of [
    "packages/schemas/src/index.ts",
    "packages/db/drizzle/0010.sql",
    "services/core/src/index.ts",
  ]) {
    const commands = planPrChecks([file]);
    const affectedCommands = commands.filter((args) =>
      args.includes("scripts/dev/turbo-affected.mjs")
    );
    assert.equal(affectedCommands.length, 2);
    assert.ok(affectedCommands[0].includes("check"));
    assert.ok(affectedCommands[1].includes("test"));
    assert.ok(commands.every((args) => !args.includes("--changed-only")));
  }
});

test("failed or interrupted checks stop the lane without a green result", () => {
  for (const status of [7, null]) {
    let calls = 0;
    const result = runPrChecks([["first"], ["second"]], () => {
      calls += 1;
      return { status };
    });
    assert.equal(result, status ?? 1);
    assert.equal(calls, 1);
  }
});

test("check completes before tests start and each phase keeps bounded parallelism", () => {
  const executed = [];
  runPrChecks(planPrChecks(["services/core/src/index.ts"]), (_binary, args) => {
    if (args.includes("verify:worker-zod-imports")) {
      return { status: 0 };
    }
    executed.push(args);
    assert.ok(args.includes("--concurrency=2"));
    assert.notEqual(args.includes("check"), args.includes("test"));
    return { status: 0 };
  });
  assert.ok(executed[0].includes("check"));
  assert.ok(executed[1].includes("test"));
});

test("executable files inside documentation or skills are not documentation-only", () => {
  for (const file of [
    "docs/example.ts",
    ".agents/skills/example/scripts/check.mjs",
  ]) {
    assert.ok(planPrChecks([file]).some((args) => args.includes("test")));
  }
});

test("unit aliases retain package-owned configuration and reject cycles", () => {
  assert.equal(
    resolveUnitTestScript({
      test: "pnpm run test:boundary",
      "test:boundary": "vitest run --config vitest.boundary.config.ts",
    }),
    "vitest run --config vitest.boundary.config.ts"
  );
  assert.throws(
    () => resolveUnitTestScript({ test: "pnpm run test" }),
    CIRCULAR_ALIAS
  );
});

test("focused tests build dependencies once through Turbo, not the changed app", () => {
  const commands = planPrChecks(["clients/web/src/app.tsx"], {
    feedback: true,
    existingFiles: ["clients/web/src/app.tsx", "clients/web/src/app.test.tsx"],
    workspaces: [
      { directory: "clients/web", name: "openmeld-web", test: "vitest run" },
    ],
  });
  assert.deepEqual(commands[1], [
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=openmeld-web^...",
    "--concurrency=1",
  ]);
  assert.ok(commands[2].includes("src/app.test.tsx"));
});

test("a shared component without an adjacent test does not trigger a workspace sweep", () => {
  const commands = planPrChecks(["clients/web/src/shared-video.tsx"], {
    feedback: true,
    existingFiles: ["clients/web/src/shared-video.tsx"],
    workspaces: [
      { directory: "clients/web", name: "openmeld-web", test: "vitest run" },
    ],
  });
  assert.deepEqual(commands, [
    [
      "exec",
      "biome",
      "check",
      "--no-errors-on-unmatched",
      "--",
      "clients/web/src/shared-video.tsx",
    ],
  ]);
});

test("focused Node tests run after changed workspace dependencies are built", () => {
  const commands = planPrChecks(
    [
      "clients/desktop/src/main/main.ts",
      "scripts/release/desktop-preview.mjs",
      "scripts/release/desktop-preview.test.mjs",
    ],
    {
      feedback: true,
      existingFiles: [
        "clients/desktop/src/main/main.ts",
        "clients/desktop/src/main/main.test.ts",
        "clients/desktop/package.json",
        "scripts/release/desktop-preview.mjs",
        "scripts/release/desktop-preview.test.mjs",
      ],
      workspaces: [
        {
          directory: "clients/desktop",
          name: "@openmeld/desktop",
          test: "vitest run",
        },
      ],
    }
  );
  const buildIndex = commands.findIndex((args) => args.includes("turbo"));
  const nodeTestIndex = commands.findIndex(
    (args) => args.includes("node") && args.includes("--test")
  );
  assert.ok(buildIndex >= 0);
  assert.ok(nodeTestIndex > buildIndex);
});
