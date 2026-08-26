import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const readRepoFile = (relativePath) =>
  readFileSync(path.join(REPO_ROOT, relativePath), "utf8");

const APPLE_SECRET_NAMES = [
  "APPLE_DEVELOPER_ID_P12_BASE64",
  "APPLE_DEVELOPER_ID_P12_PASSWORD",
  "APPLE_NOTARY_KEY_P8_BASE64",
  "APPLE_NOTARY_KEY_ID",
  "APPLE_NOTARY_ISSUER_ID",
  "APPLE_TEAM_ID",
];
const GITHUB_EXPRESSION_PREFIX = ["$", "{{"].join("");
const GITHUB_TOKEN_EXPRESSION = `${GITHUB_EXPRESSION_PREFIX} github.token }}`;
const RELEASE_TAG_PUSH = ['git push origin "refs/tags/v$', '{version}"'].join(
  ""
);

test("keeps the trusted GitHub release publication-only and focused on CLI and Core", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");

  assert.ok(!source.includes("      mode:"));
  assert.ok(!source.includes("  verify:"));
  assert.ok(!source.includes("pnpm run verify:release-ready"));
  assert.ok(!source.includes("      rollout:"));
  assert.ok(!source.includes("      bootstrap_routines:"));
  assert.ok(!source.includes("  database:"));
  assert.ok(!source.includes("  auth:"));
  assert.ok(!source.includes("  remote_agent:"));
  assert.ok(!source.includes("  gateway:"));
  assert.ok(!source.includes("  web:"));
  assert.ok(!source.includes("  summary:"));
  assert.ok(!source.includes("  release_ready:"));
  assert.ok(source.includes("  reject_non_main:"));
  assert.ok(source.includes("  cli_release:"));
  assert.ok(source.includes("if: github.ref == 'refs/heads/main'"));
  assert.ok(source.includes("group: cli-production-release"));
  assert.equal(source.match(/cancel-in-progress: false/gu)?.length, 2);
});

test("keeps the signed and notarized CLI publisher fail closed", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");
  const cliStart = source.indexOf("  cli_release:");
  const cliJobSource = source.slice(cliStart);

  assert.notEqual(cliStart, -1);
  assert.ok(cliJobSource.includes("runs-on: macos-15"));
  assert.ok(
    cliJobSource.includes("id-token") || source.includes("id-token: write")
  );
  assert.ok(cliJobSource.includes("npm install --global npm@11.18.0"));
  assert.ok(
    cliJobSource.includes(
      "node ../release-control/scripts/release/hosted-cli-release.mjs ."
    )
  );
  assert.ok(
    cliJobSource.includes(
      "normal|resume-after-binary-upload|resume-after-npm-publish"
    )
  );
  assert.ok(!cliJobSource.includes("tagCliRelease"));
  assert.ok(!cliJobSource.includes("pnpm run deploy:core:local-components"));
  assert.ok(cliJobSource.includes("actions/upload-artifact@v4"));
  assert.ok(cliJobSource.includes("Verify Core deployment is visible"));
  assert.ok(cliJobSource.includes('NPM_CONFIG_PROVENANCE: "false"'));
  assert.ok(!cliJobSource.includes(RELEASE_TAG_PUSH));
  for (const secretName of APPLE_SECRET_NAMES) {
    assert.ok(
      cliJobSource.includes(
        `${secretName}: ${GITHUB_EXPRESSION_PREFIX} secrets.${secretName} }}`
      ),
      `missing ${secretName}`
    );
  }
  for (const forbidden of [
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "registry-url",
    "resume_from_cli",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `forbidden workflow token: ${forbidden}`
    );
  }
});

test("injects production credentials only into the steps that consume them", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");
  const cliStart = source.indexOf("  cli_release:");
  const stepsStart = source.indexOf("    steps:", cliStart);
  const publishStart = source.indexOf(
    "      - name: Publish signed and notarized CLI",
    stepsStart
  );
  const preserveStart = source.indexOf(
    "      - name: Preserve a failed Core startup profile",
    publishStart
  );
  const publishStep = source.slice(publishStart, preserveStart);

  assert.notEqual(cliStart, -1);
  assert.notEqual(stepsStart, -1);
  assert.notEqual(publishStart, -1);
  assert.notEqual(preserveStart, -1);
  assert.ok(!source.slice(cliStart, stepsStart).includes("secrets."));
  for (const secretName of APPLE_SECRET_NAMES) {
    assert.ok(publishStep.includes(`secrets.${secretName}`));
  }
  assert.ok(publishStep.includes("secrets.CLOUDFLARE_ACCOUNT_ID"));
  assert.ok(publishStep.includes("secrets.CLOUDFLARE_API_TOKEN"));
});

test("keeps private-repository tag auth inside trusted control and away from release commands", () => {
  const workflow = readRepoFile(".github/workflows/cli-release.yml");
  const hostedRelease = readRepoFile("scripts/release/hosted-cli-release.mjs");
  const releaseEngine = readRepoFile("scripts/release/release-cli.mjs");

  assert.ok(
    workflow.includes(
      `OPENMELD_TRUSTED_GIT_GITHUB_TOKEN: ${GITHUB_TOKEN_EXPRESSION}`
    )
  );
  assert.ok(hostedRelease.includes("createTrustedGitEnvironment"));
  assert.ok(hostedRelease.includes("localGitEnvironment"));
  assert.ok(hostedRelease.includes("authenticatedGitEnvironment"));
  assert.ok(
    hostedRelease.includes(
      'Reflect.deleteProperty(process.env, "OPENMELD_TRUSTED_GIT_GITHUB_TOKEN")'
    )
  );
  assert.ok(hostedRelease.includes("env: releaseEnvironment"));
  assert.ok(releaseEngine.includes('"push",\n        "--no-verify"'));
});

test("shares CLI and Core production leases with the local release lane", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");

  assert.ok(source.includes("Acquire shared CLI publication lease"));
  assert.ok(source.includes("Acquire shared Core projection lease"));
  assert.ok(source.includes("Release shared Core projection lease"));
  assert.ok(source.includes("Release shared CLI publication lease"));
  assert.ok(source.includes("scope: cli"));
  assert.ok(source.includes("scope: core"));
  assert.equal(
    source.match(
      /uses: \.\/release-control\/\.github\/actions\/production-scope-lease/gu
    )?.length,
    4
  );
  for (const leaseStep of source
    .split("uses: ./release-control/.github/actions/production-scope-lease")
    .slice(1)) {
    assert.ok(
      leaseStep
        .split("\n\n")[0]
        ?.includes(`github_token: ${GITHUB_TOKEN_EXPRESSION}`)
    );
  }
  assert.equal(
    source.match(/working_directory: release-source/gu)?.length >= 4,
    true
  );
});

test("uses the exact release SHA for CLI publication and recovery", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");
  assert.ok(
    source.includes(
      `RELEASE_SHA: ${GITHUB_EXPRESSION_PREFIX} inputs.release_sha || github.sha }}`
    )
  );
  assert.ok(
    source.includes(`ref: ${GITHUB_EXPRESSION_PREFIX} env.RELEASE_SHA }}`)
  );
  assert.ok(source.includes("path: release-control"));
  assert.ok(source.includes("path: release-source"));
  assert.ok(
    source.indexOf("path: release-control") <
      source.indexOf("path: release-source")
  );
  assert.ok(source.includes("working-directory: release-source"));
  assert.equal(source.match(/persist-credentials: false/gu)?.length, 2);
});

test("validates current main first-parent membership before publication", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");

  const releaseStart = source.indexOf("  cli_release:");
  const releaseSource = source.slice(releaseStart);
  const mainlineValidation = releaseSource.indexOf(
    "node scripts/release/require-mainline-release-sha.mjs"
  );
  const publish = releaseSource.indexOf(
    "Publish signed and notarized CLI, binary channel, npm package, tag, and Core"
  );
  assert.ok(
    releaseSource.includes(`if [ "\${GITHUB_REF}" != "refs/heads/main" ]`)
  );
  assert.ok(
    releaseSource.includes(
      "release_sha must be an exact 40-character lowercase commit SHA"
    )
  );
  assert.ok(releaseSource.includes("operation: fetch-main"));
  assert.ok(
    releaseSource.includes(
      "uses: ./release-control/.github/actions/trusted-git-network"
    )
  );
  assert.ok(mainlineValidation >= 0);
  assert.ok(publish > mainlineValidation);
});

test("keeps the Remote Agent release check on the repository-pinned formatter", () => {
  const remoteAgentPackage = JSON.parse(
    readRepoFile("services/remote-agent/package.json")
  );

  assert.equal(
    remoteAgentPackage.scripts.check,
    "biome check . && pnpm run typecheck"
  );
  assert.ok(
    remoteAgentPackage.scripts.deploy.includes(
      "wrangler deploy --config dist/openmeld_remote_agent/wrangler.prod.json"
    )
  );
  assert.ok(!remoteAgentPackage.scripts.deploy.includes("--minify"));
});

test("gives every Web release build an explicit CI heap budget", () => {
  const source = readRepoFile(".github/workflows/deploy-web.yml");
  const jobStart = source.indexOf("\n  deploy:");
  const stepsStart = source.indexOf("    steps:", jobStart);

  assert.notEqual(jobStart, -1, "missing Web deploy job");
  assert.notEqual(stepsStart, -1, "missing Web deploy steps");
  assert.ok(
    source
      .slice(jobStart, stepsStart)
      .includes('    env:\n      NODE_OPTIONS: "--max-old-space-size=4096"')
  );
});

test("builds Web workspace dependencies before a production Vite build", () => {
  const packageJson = JSON.parse(readRepoFile("clients/web/package.json"));

  assert.equal(
    packageJson.scripts["build:prod"],
    "pnpm -C ../.. exec turbo run build --filter=openmeld-web^... && CLOUDFLARE_ENV=prod vite build"
  );
});

test("builds Worker workspace dependencies before every production deploy", () => {
  const workers = [
    ["services/auth/package.json", "@openmeld/auth-worker"],
    ["services/core/package.json", "@openmeld/core"],
    ["services/gateway/package.json", "@openmeld/gateway"],
    ["services/remote-agent/package.json", "@openmeld/remote-agent"],
  ];

  for (const [packagePath, packageName] of workers) {
    const packageJson = JSON.parse(readRepoFile(packagePath));
    const expectedBuild = `pnpm -C ../.. exec turbo run build --filter=${packageName}^...`;

    assert.equal(
      packageJson.scripts["build:workspace-dependencies"],
      expectedBuild,
      `${packageName} must own its production dependency build`
    );
    assert.ok(
      packageJson.scripts.deploy.startsWith(
        "pnpm run build:workspace-dependencies && "
      ),
      `${packageName} must build workspace dependencies before deployment`
    );
  }
});
