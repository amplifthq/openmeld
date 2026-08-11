import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTurboAffectedTaskArgs,
  resolveExplicitAffectedPackages,
  resolveTurboAffectedFilters,
  resolveTurboCommandArgs,
} from "./affected-workspaces.mjs";

const EXACT_TURBO_VERSION_ERROR_REGEX = /exact Turbo version/u;

const WORKSPACES = [
  {
    dependencies: ["@openmeld/schemas"],
    name: "@openmeld/core",
    relativePath: "services/core",
  },
  {
    dependencies: ["@flue/runtime", "@openmeld/schemas"],
    name: "@openmeld/remote-agent",
    relativePath: "services/remote-agent",
  },
  {
    dependencies: [],
    name: "@openmeld/schemas",
    relativePath: "packages/schemas",
  },
];
const PATCH_ONLY_LOCKFILE_DIFF = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -32,3 +32,3 @@ patchedDependencies:
   '@flue/runtime@1.0.0-beta.9':
-    hash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
+    hash: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
@@ -1182,3 +1182,3 @@ importers:
       '@flue/runtime':
-        version: 1.0.0-beta.9(patch_hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)
+        version: 1.0.0-beta.9(patch_hash=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)
`;

test("keeps a patched dependency hotfix scoped to its workspace consumers", () => {
  assert.deepEqual(
    resolveExplicitAffectedPackages({
      changedPaths: [
        "patches/@flue__runtime@1.0.0-beta.9.patch",
        "pnpm-lock.yaml",
        "services/remote-agent/tests/flue-zero-timeout.test.ts",
      ],
      lockfileDiff: PATCH_ONLY_LOCKFILE_DIFF,
      workspacePackages: WORKSPACES,
    }),
    ["@openmeld/remote-agent"]
  );
});

test("falls back when a lockfile change is not proven to come from a patch", () => {
  assert.equal(
    resolveExplicitAffectedPackages({
      changedPaths: ["packages/schemas/package.json", "pnpm-lock.yaml"],
      workspacePackages: WORKSPACES,
    }),
    null
  );
});

test("falls back when a patch is mixed with an unrelated workspace change", () => {
  assert.equal(
    resolveExplicitAffectedPackages({
      changedPaths: [
        "patches/@flue__runtime@1.0.0-beta.9.patch",
        "pnpm-lock.yaml",
        "services/core/src/index.ts",
      ],
      lockfileDiff: PATCH_ONLY_LOCKFILE_DIFF,
      workspacePackages: WORKSPACES,
    }),
    null
  );
});

test("falls back when the lockfile diff contains an unrelated dependency", () => {
  assert.equal(
    resolveExplicitAffectedPackages({
      changedPaths: [
        "patches/@flue__runtime@1.0.0-beta.9.patch",
        "pnpm-lock.yaml",
        "services/remote-agent/tests/flue-zero-timeout.test.ts",
      ],
      lockfileDiff: `${PATCH_ONLY_LOCKFILE_DIFF}
-      lodash: 4.17.20
+      lodash: 4.17.21
`,
      workspacePackages: WORKSPACES,
    }),
    null
  );
});

test("falls back when the lockfile patch hash belongs to another package", () => {
  assert.equal(
    resolveExplicitAffectedPackages({
      changedPaths: [
        "patches/@flue__runtime@1.0.0-beta.9.patch",
        "pnpm-lock.yaml",
      ],
      lockfileDiff: PATCH_ONLY_LOCKFILE_DIFF.replaceAll(
        "@flue/runtime",
        "@other/runtime"
      ),
      workspacePackages: WORKSPACES,
    }),
    null
  );
});

test("falls back when a patch hash reference belongs to another package", () => {
  assert.equal(
    resolveExplicitAffectedPackages({
      changedPaths: [
        "patches/@flue__runtime@1.0.0-beta.9.patch",
        "pnpm-lock.yaml",
      ],
      lockfileDiff: PATCH_ONLY_LOCKFILE_DIFF.replace(
        "      '@flue/runtime':\n-        version:",
        "      '@other/runtime':\n-        version:"
      ),
      workspacePackages: WORKSPACES,
    }),
    null
  );
});

test("falls back to Turbo for lockfile-only and ordinary source changes", () => {
  assert.equal(
    resolveExplicitAffectedPackages({
      changedPaths: ["pnpm-lock.yaml"],
      workspacePackages: WORKSPACES,
    }),
    null
  );
  assert.equal(
    resolveExplicitAffectedPackages({
      changedPaths: ["services/core/src/index.ts"],
      workspacePackages: WORKSPACES,
    }),
    null
  );
});

test("keeps the fast PR scope to changed workspaces", () => {
  assert.deepEqual(
    resolveTurboAffectedFilters({
      baseRef: "origin/main",
      changedOnly: true,
      explicitAffectedPackages: null,
      lockfileChanged: false,
    }),
    ["--filter=[origin/main]"]
  );
});

test("keeps full affected validation on changed workspaces and dependents", () => {
  assert.deepEqual(
    resolveTurboAffectedFilters({
      baseRef: "origin/main",
      changedOnly: false,
      explicitAffectedPackages: null,
      lockfileChanged: false,
    }),
    ["--filter=...[origin/main]"]
  );
});

test("keeps ordinary lockfile changes on the dependent-aware path", () => {
  assert.deepEqual(
    resolveTurboAffectedFilters({
      baseRef: "origin/main",
      changedOnly: true,
      explicitAffectedPackages: null,
      lockfileChanged: true,
    }),
    ["--filter=...[origin/main]"]
  );
});

test("keeps an explicitly proven patch hotfix on its selected workspaces", () => {
  assert.deepEqual(
    resolveTurboAffectedFilters({
      baseRef: "origin/main",
      changedOnly: true,
      explicitAffectedPackages: ["@openmeld/remote-agent"],
      lockfileChanged: true,
    }),
    ["--filter=@openmeld/remote-agent"]
  );
});

test("parses CI-only package exclusions without treating them as tasks", () => {
  assert.deepEqual(
    parseTurboAffectedTaskArgs([
      "--changed-only",
      "--exclude-package=openmeld-web",
      "--exclude-package=@openmeld/core",
      "test",
    ]),
    {
      changedOnly: true,
      excludedPackages: ["@openmeld/core", "openmeld-web"],
      taskNames: ["test"],
    }
  );
});

test("adds package exclusions to the canonical affected filters", () => {
  assert.deepEqual(
    resolveTurboAffectedFilters({
      baseRef: "origin/main",
      changedOnly: true,
      excludedPackages: ["@openmeld/core", "openmeld-web"],
      explicitAffectedPackages: null,
      lockfileChanged: false,
    }),
    [
      "--filter=[origin/main]",
      "--filter=!@openmeld/core",
      "--filter=!openmeld-web",
    ]
  );
});

test("uses the installed Turbo command outside the lightweight CI planner", () => {
  assert.deepEqual(
    resolveTurboCommandArgs({
      turboRunArgs: ["run", "test", "--dry=json"],
    }),
    ["turbo", "run", "test", "--dry=json"]
  );
});

test("uses only an exact Turbo package in the lightweight CI planner", () => {
  assert.deepEqual(
    resolveTurboCommandArgs({
      dlxPackage: "turbo@2.9.6",
      turboRunArgs: ["run", "test", "--dry=json"],
    }),
    ["dlx", "turbo@2.9.6", "run", "test", "--dry=json"]
  );
  assert.throws(
    () =>
      resolveTurboCommandArgs({
        dlxPackage: "turbo@latest",
        turboRunArgs: ["run", "test"],
      }),
    EXACT_TURBO_VERSION_ERROR_REGEX
  );
});
