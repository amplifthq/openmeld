// Production deployment units. This table is the only release topology:
// `paths` selects a component, `dependsOn` orders it, and `defaultLane`
// chooses where `--lane auto` runs it. `deploy` and `health` are the
// component's idempotent steps; scripts/release/deploy-component.mjs runs
// them unchanged on a workstation and in .github/workflows/deploy.yml.

const SHARED = "packages/{schemas,protocol,utils,gateway-contract}/**";
const SPACE =
  "packages/{agent-runtime,projects,routine-schedule,space,space-mesh,start}/**";
// Migrations select only db; a "!" entry excludes paths from a component.
const SERVER = [
  SPACE,
  "packages/{auth,db}/**",
  "!packages/db/{postgresql,drizzle}/**",
];
const LOCAL =
  "{runtime/**,packages/{api-client,agent-profile,product-catalog,ui}/**}";
const releaseVar = (sha) => `RELEASE_SHA:${sha}`;
const pnpmDeploy = (pkg) => (sha) => [
  ["pnpm", "--filter", pkg, "run", "deploy", "--var", releaseVar(sha)],
];
const renderer = (client) => () => [
  ["pnpm", "--filter", `openmeld-${client}`, "run", "deploy"],
];

export const COMPONENTS = [
  {
    name: "db",
    paths: ["packages/db/postgresql/migrations/**"],
    dependsOn: [],
    defaultLane: "github",
    postgresql: true,
    // PostgreSQL has no release marker. Core follows every migration, so its
    // live SHA bounds what the database already received.
    releaseShaFrom: "core",
    deploy: () => [
      ["node", "tooling/postgresql/cutover.mjs", "migrate"],
      ["node", "tooling/postgresql/cutover.mjs", "grant-runtime"],
    ],
    health: {
      kind: "command",
      command: ["node", "tooling/postgresql/cutover.mjs", "verify"],
    },
  },
  {
    name: "auth",
    paths: [
      "services/auth/**",
      "packages/{auth,db}/**",
      "!packages/db/{postgresql,drizzle}/**",
      SHARED,
    ],
    dependsOn: ["db"],
    defaultLane: "github",
    deploy: pnpmDeploy("@openmeld/auth-worker"),
    health: { kind: "worker-health", url: "https://auth.openmeld.ai/health" },
  },
  {
    name: "core",
    paths: [
      "services/core/**",
      "runtime/adapters/core/**",
      ...SERVER,
      SHARED,
      "release/vendor-models.json",
    ],
    dependsOn: ["db", "auth"],
    defaultLane: "github",
    postgresql: true,
    deploy: (sha) => [
      ["node", "scripts/release/deploy-core-worker.mjs", "--release-sha", sha],
    ],
    health: { kind: "worker-version", script: "openmeld-core-prod" },
  },
  {
    name: "gateway",
    paths: [
      "services/gateway/**",
      "runtime/adapters/core/**",
      ...SERVER,
      SHARED,
    ],
    dependsOn: ["core"],
    defaultLane: "github",
    deploy: pnpmDeploy("@openmeld/gateway"),
    health: {
      kind: "worker-health",
      url: "https://gateway.openmeld.ai/health",
    },
  },
  {
    name: "remote-agent",
    paths: [
      "services/remote-agent/**",
      "runtime/adapters/core/**",
      ...SERVER,
      SHARED,
    ],
    dependsOn: ["core"],
    defaultLane: "github",
    deploy: pnpmDeploy("@openmeld/remote-agent"),
    health: { kind: "worker-version", script: "openmeld-remote-agent-prod" },
  },
  {
    name: "web",
    // Web serves the signed OpenMeld CLI skill bundle.
    paths: [
      "clients/web/**",
      "release/openmeld-cli-skill/**",
      LOCAL,
      ...SERVER,
      SHARED,
    ],
    dependsOn: ["auth", "core", "gateway", "remote-agent"],
    defaultLane: "github",
    heavy: "about 60 minutes on a workstation; about 15 minutes on GitHub",
    deploy: renderer("web"),
    health: { kind: "renderer", url: "https://app.openmeld.ai" },
  },
  {
    name: "website",
    paths: [
      "clients/website/**",
      "packages/{api-client,product-catalog,ui}/**",
      SHARED,
    ],
    dependsOn: [],
    defaultLane: "github",
    deploy: renderer("website"),
    health: { kind: "renderer", url: "https://openmeld.ai" },
  },
  {
    name: "docs",
    paths: ["clients/docs/**", "packages/{schemas,ui}/**"],
    dependsOn: [],
    defaultLane: "github",
    deploy: renderer("docs"),
    health: { kind: "renderer", url: "https://docs.openmeld.ai" },
  },
  {
    name: "cli",
    paths: [
      "clients/openmeld-cli/**",
      "release/local-components-policy.json",
      LOCAL,
      SPACE,
      SHARED,
    ],
    dependsOn: ["core"],
    defaultLane: "github",
    heavy: "about 20 minutes; a workstation needs the Apple signing identity",
    deploy: (sha) => [
      ["node", "scripts/release/publish-cli.mjs", "--release-sha", sha],
    ],
    health: { kind: "cli" },
  },
];

// `cloud` is the explicit all-Workers rollout. It never includes db or cli.
export const SCOPE_ALIASES = {
  cloud: ["auth", "core", "gateway", "remote-agent", "web", "website", "docs"],
};
