import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { COMPONENTS } from "../../release/components.mjs";
import {
  buildGithubDispatch,
  componentMatchesPath,
  expandScope,
  orderComponents,
  parseDeployArgs,
  planAutoScope,
  planLaneSegments,
  selectAutoScope,
} from "./deploy.mjs";
import {
  assertReleaseCheckout,
  describeComponentSteps,
  releaseEnvironment,
} from "./deploy-component.mjs";
import {
  readRendererSha,
  readWorkerHealthSha,
  readWorkerVersionSha,
} from "./live-release.mjs";

const UNKNOWN_COMPONENT = /Unknown component "api"/u;
const SCOPE_REQUIRED = /--scope is required/u;
const LIVE_SHA_UNKNOWN =
  /Cannot read the live release SHA of db, auth, core, gateway, remote-agent, web, cli/u;
const WRONG_SOURCE = /is not the release SHA/u;
const DIRTY_SOURCE = /uncommitted changes/u;
const VERSION_URL =
  /\/workers\/scripts\/openmeld-core-prod\/versions\/105ee5c0-0738-47b4-8819-89b00d4fc525$/u;
const TARGET = "b".repeat(40);
const LIVE = "a".repeat(40);
const component = (name) => COMPONENTS.find((entry) => entry.name === name);
const selectedFor = (file) =>
  COMPONENTS.filter((entry) => componentMatchesPath(entry, file)).map(
    (entry) => entry.name
  );

test("selects components by their own paths without widening to dependents", () => {
  assert.deepEqual(selectedFor("clients/website/src/routes/index.tsx"), [
    "website",
  ]);
  assert.deepEqual(selectedFor("clients/web/src/routes/login.tsx"), ["web"]);
  assert.deepEqual(selectedFor("services/gateway/src/routes/root.ts"), [
    "gateway",
  ]);
  assert.deepEqual(
    selectedFor("packages/db/postgresql/migrations/0042_add.sql"),
    ["db"]
  );
  assert.deepEqual(selectedFor("release/openmeld-cli-skill/SKILL.md"), ["web"]);
  assert.deepEqual(
    selectedFor("developing/engineering/production-release.md"),
    []
  );
  assert.deepEqual(selectedFor("packages/schemas/src/index.ts"), [
    "auth",
    "core",
    "gateway",
    "remote-agent",
    "web",
    "website",
    "docs",
    "cli",
  ]);
});

test("orders selected components by dependsOn and ignores unselected dependencies", () => {
  assert.deepEqual(orderComponents(["web", "core", "db", "gateway"]), [
    "db",
    "core",
    "gateway",
    "web",
  ]);
  assert.deepEqual(orderComponents(["web", "auth"]), ["auth", "web"]);
  assert.deepEqual(orderComponents(["cli", "core"]), ["core", "cli"]);
  assert.deepEqual(orderComponents(["docs"]), ["docs"]);
});

test("expands explicit scopes and rejects unknown components", () => {
  assert.equal(expandScope("auto"), null);
  assert.deepEqual(expandScope("cloud"), [
    "auth",
    "core",
    "gateway",
    "remote-agent",
    "web",
    "website",
    "docs",
  ]);
  assert.deepEqual(expandScope("core, gateway"), ["core", "gateway"]);
  assert.throws(() => expandScope("api"), UNKNOWN_COMPONENT);
  assert.throws(() => parseDeployArgs(["--lane", "github"]), SCOPE_REQUIRED);
  assert.equal(parseDeployArgs(["--", "--scope", "web"]).lane, "auto");
});

test("splits lanes and the CLI publisher into ordered segments after their dependencies", () => {
  assert.deepEqual(planLaneSegments(["db", "core", "gateway", "web"], "auto"), [
    { lane: "github", components: ["db", "core", "gateway", "web"] },
  ]);
  const localDatabase = (name) =>
    ["db", "core"].includes(name) ? "local" : "github";
  assert.deepEqual(
    planLaneSegments(["db", "core", "gateway", "web"], "auto", localDatabase),
    [
      { lane: "local", components: ["db", "core"] },
      { lane: "github", components: ["gateway", "web"] },
    ]
  );
  assert.deepEqual(planLaneSegments(["core", "gateway"], "local"), [
    { lane: "local", components: ["core", "gateway"] },
  ]);
  for (const lane of ["local", "auto"]) {
    assert.throws(
      () => planLaneSegments(["core", "cli"], lane, () => "local"),
      { message: "cli cannot run on --lane local. Use --lane github." }
    );
  }
  assert.deepEqual(planLaneSegments(["cli"], "auto"), [
    { lane: "github", components: ["cli"] },
  ]);
  assert.deepEqual(
    planLaneSegments(orderComponents(["cli", "web", "core"]), "github"),
    [
      { lane: "github", components: ["core", "web"] },
      { lane: "github", components: ["cli"] },
    ]
  );
  assert.deepEqual(planLaneSegments(["cli", "web"], "github"), [
    { lane: "github", components: ["cli"] },
    { lane: "github", components: ["web"] },
  ]);
});

test("dispatches cloud and CLI segments through their own top-level workflows on main", () => {
  assert.deepEqual(
    buildGithubDispatch({
      repository: "amplifthq/openmeld",
      sha: TARGET,
      components: ["gateway", "web"],
    }),
    [
      "workflow",
      "run",
      "deploy.yml",
      "--repo",
      "amplifthq/openmeld",
      "--ref",
      "main",
      "-f",
      `sha=${TARGET}`,
      "-f",
      "scopes=gateway,web",
    ]
  );
  assert.deepEqual(
    buildGithubDispatch({
      repository: "amplifthq/openmeld",
      sha: TARGET,
      components: ["cli"],
    }),
    [
      "workflow",
      "run",
      "cli-release.yml",
      "--repo",
      "amplifthq/openmeld",
      "--ref",
      "main",
      "-f",
      `release_sha=${TARGET}`,
    ]
  );
  assert.throws(
    () =>
      buildGithubDispatch({
        repository: "amplifthq/openmeld",
        sha: TARGET,
        components: ["core", "cli"],
      }),
    {
      message:
        "CLI publication must be dispatched separately through cli-release.yml.",
    }
  );
});

test("auto scope diffs each component from its live SHA and falls back to --base only when unknown", async () => {
  const diffs = [];
  const git = {
    isAncestor: (ancestor) => ancestor === LIVE,
    diffNames(from) {
      diffs.push(from);
      return from === LIVE
        ? ["clients/website/src/a.tsx"]
        : ["services/gateway/src/b.ts", "pnpm-lock.yaml"];
    },
  };
  const live = { website: LIVE, docs: TARGET, web: "c".repeat(40) };
  const plan = await planAutoScope({
    sha: TARGET,
    base: "d".repeat(40),
    git,
    readLive: async (entry) => live[entry.name] ?? null,
  });
  const byName = Object.fromEntries(plan.map((entry) => [entry.name, entry]));
  assert.equal(byName.docs.current, true);
  assert.deepEqual(byName.website.changedPaths, ["clients/website/src/a.tsx"]);
  assert.equal(byName.website.fromLive, true);
  // A live SHA outside the target's history is not trusted as a diff base.
  assert.equal(byName.web.from, "d".repeat(40));
  assert.deepEqual(byName.gateway.changedPaths, ["services/gateway/src/b.ts"]);
  assert.deepEqual(byName.gateway.rootInputs, ["pnpm-lock.yaml"]);

  await assert.rejects(
    planAutoScope({
      sha: TARGET,
      git,
      readLive: async (entry) => live[entry.name] ?? null,
    }),
    LIVE_SHA_UNKNOWN
  );
});

// biome-ignore lint/style/noDoneCallback: node:test supplies a TestContext, not a done callback.
test("auto scope warns about a migration without Core and does not widen scope", async (t) => {
  const warnings = [];
  t.mock.method(process.stderr, "write", (message) => {
    warnings.push(message);
    return true;
  });
  t.mock.method(process.stdout, "write", () => true);
  for (const includeCore of [false, true]) {
    warnings.length = 0;
    const selected = await selectAutoScope({
      sha: TARGET,
      base: LIVE,
      readLive: async () => null,
      git: {
        isAncestor: () => true,
        diffNames: () => [
          "packages/db/postgresql/migrations/0042_add.sql",
          ...(includeCore ? ["services/core/src/index.ts"] : []),
        ],
      },
    });
    assert.deepEqual(selected, includeCore ? ["db", "core"] : ["db"]);
    assert.equal(warnings.length, includeCore ? 0 : 1);
    if (!includeCore) {
      assert.ok(warnings[0].includes("live Core"));
      assert.ok(warnings[0].includes("--scope db,core"));
    }
  }
});

test("runs component steps only from a clean checkout of the exact release SHA", () => {
  const git = (status) => (_cwd, args) =>
    args[0] === "rev-parse" ? TARGET : status;
  assert.doesNotThrow(() =>
    assertReleaseCheckout({ cwd: ".", sha: TARGET, git: git("") })
  );
  assert.throws(
    () => assertReleaseCheckout({ cwd: ".", sha: LIVE, git: git("") }),
    WRONG_SOURCE
  );
  assert.throws(
    () => assertReleaseCheckout({ cwd: ".", sha: TARGET, git: git(" M file") }),
    DIRTY_SOURCE
  );
});

test("passes the release SHA to every Worker deploy and maps the release token once", () => {
  for (const name of ["auth", "gateway", "remote-agent"]) {
    assert.ok(
      describeComponentSteps(component(name), TARGET).deploy.some((command) =>
        command.includes(`RELEASE_SHA:${TARGET}`)
      ),
      name
    );
  }
  assert.deepEqual(describeComponentSteps(component("core"), TARGET).deploy, [
    [
      process.execPath,
      fileURLToPath(new URL("./deploy-core-worker.mjs", import.meta.url)),
      "--release-sha",
      TARGET,
    ],
  ]);
  const env = releaseEnvironment(
    {
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_API_TOKEN: "",
      CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN: "token",
    },
    TARGET
  );
  assert.equal(env.CLOUDFLARE_API_TOKEN, "token");
  assert.equal(env.RELEASE_SHA, TARGET);
});

test("refuses missing production credentials before running component steps", () => {
  for (const env of [
    {},
    { CLOUDFLARE_ACCOUNT_ID: "account" },
    { CLOUDFLARE_API_TOKEN: "token" },
  ]) {
    assert.throws(
      () => releaseEnvironment(env, TARGET),
      (error) => {
        assert.ok(
          error.message.startsWith(
            "Production release credentials are missing:"
          )
        );
        assert.ok(!error.message.includes("token."));
        return true;
      }
    );
  }
});

test("loads control scripts beside the component runner and build inputs from the source checkout", () => {
  for (const entry of COMPONENTS) {
    const steps = describeComponentSteps(entry, TARGET);
    for (const command of [...steps.deploy, steps.health]) {
      if (command[0] === process.execPath || command[0] === "node") {
        assert.ok(path.isAbsolute(command[1]), entry.name);
      }
    }
  }
  const source = mkdtempSync(path.join(tmpdir(), "release-source-"));
  try {
    mkdirSync(path.join(source, "clients/openmeld-cli"), { recursive: true });
    writeFileSync(
      path.join(source, "clients/openmeld-cli/package.json"),
      JSON.stringify({ version: "9.9.9" })
    );
    const buildModule = new URL("./build-cli-binary.mjs", import.meta.url).href;
    const databaseModule = new URL(
      "../../tooling/postgresql/database.mjs",
      import.meta.url
    ).href;
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { resolveCliPackageVersion, resolveDefaultCliBinaryOutDir } from ${JSON.stringify(buildModule)};
      import { migrationDirectory } from ${JSON.stringify(databaseModule)};
      console.log(JSON.stringify([resolveCliPackageVersion(), resolveDefaultCliBinaryOutDir(), migrationDirectory]));
    `,
      ],
      {
        env: { ...process.env, OPENMELD_RELEASE_SOURCE_ROOT: source },
        encoding: "utf8",
      }
    );
    assert.deepEqual(JSON.parse(output), [
      "9.9.9",
      path.join(source, "cli/dist"),
      path.join(source, "packages/db/postgresql/migrations"),
    ]);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

const response = (body, init = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), init);

test("reads live release SHAs from Worker health, renderer metadata, and Cloudflare versions", async () => {
  assert.equal(
    await readWorkerHealthSha("https://gateway.example/health", async () =>
      response({ ok: true, service: "openmeld-gateway", releaseSha: TARGET })
    ),
    TARGET
  );
  assert.equal(
    await readWorkerHealthSha("https://gateway.example/health", async () =>
      response({ ok: true, service: "openmeld-gateway" })
    ),
    null
  );
  // Captured from https://openmeld.ai/ on 2026-10-18 (attributes trimmed).
  const html = `<html><head><meta name="openmeld-source-sha" content="${LIVE}"/><meta name="openmeld-build-id" content="x"/></head><body><script></script></body></html>`;
  assert.equal(
    await readRendererSha("https://openmeld.ai", async () => response(html)),
    LIVE
  );

  // Shapes captured from the Cloudflare Workers deployments and versions APIs
  // for openmeld-core-prod on 2026-10-18 (identifiers replaced).
  const calls = [];
  const cloudflare = async (url) => {
    calls.push(String(url));
    await Promise.resolve();
    if (String(url).endsWith("/deployments")) {
      return response({
        success: true,
        result: {
          deployments: [
            {
              id: "082a930c-3d1b-4e86-b85d-bed563e9ca10",
              source: "wrangler",
              strategy: "percentage",
              annotations: {
                "workers/message": "",
                "workers/triggered_by": "deployment",
              },
              versions: [
                {
                  version_id: "105ee5c0-0738-47b4-8819-89b00d4fc525",
                  percentage: 100,
                },
              ],
              created_on: "2026-10-16T17:41:09.053294Z",
            },
          ],
        },
      });
    }
    return response({
      success: true,
      result: {
        id: "105ee5c0-0738-47b4-8819-89b00d4fc525",
        resources: {
          bindings: [
            {
              type: "plain_text",
              name: "CORS_ORIGINS",
              text: "https://gateway.openmeld.ai",
            },
            { type: "plain_text", name: "RELEASE_SHA", text: TARGET },
          ],
        },
      },
    });
  };
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "token",
  };
  assert.equal(
    await readWorkerVersionSha("openmeld-core-prod", env, cloudflare),
    TARGET
  );
  assert.match(calls[1], VERSION_URL);
  assert.equal(
    await readWorkerVersionSha("openmeld-core-prod", {}, cloudflare),
    null
  );
});
