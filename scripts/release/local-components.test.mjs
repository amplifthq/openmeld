import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildPackagedOpenMeldCli } from "./build-packaged-openmeld-cli.mjs";

import {
  buildReleasePolicyManifest,
  collectLocalComponentFacts,
  computeServiceBundleHash,
  OPENMELD_GREENFIELD_RELEASE_LINE,
  resolveCliRequiredFloorVerificationErrors,
  resolveEffectiveReleaseBase,
  resolveLatestReleaseTag,
  resolveReleasePolicyVerificationErrors,
  runLocalComponentsReleaseTool,
} from "./local-components.mjs";
import {
  isCliReleasePath,
  isServiceReleasePath,
  isSkillsReleasePath,
} from "./release-ready-paths.mjs";

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/u;
const SKILLS_POLICY_REQUIRED_RE =
  /OpenMeld skills changed, so skills\.updatePolicy must be available or required/u;
const STAMP_SOURCE_CHANGED_RE =
  /Release source changed while rebuilding the packaged OpenMeld CLI/u;
const STAMP_BUILD_EXPLODED_RE = /build exploded/u;
const CURRENT_ONLY_STAMP_RE = /--current is only available for verification/u;
const INVALID_CLI_FLOOR_RE =
  /minRequiredCliVersion is not a valid version: banana/u;
const FIXTURE_STAMP_DEPENDENCIES = {
  buildPackagedOpenMeldCli: () => Promise.resolve(),
};
const execFileAsync = promisify(execFile);
const GIT_HOOK_ENV = {
  GIT_DIR: "/tmp/wrong-repo/.git",
  GIT_INDEX_FILE: "/tmp/wrong-repo/index",
  GIT_WORK_TREE: "/tmp/wrong-repo",
};

test("forces packaged CLI rebuilds so stale cached output cannot enter release truth", async () => {
  const fixtureRoot = await mkdtemp(
    join(tmpdir(), "openmeld-packaged-cli-build-")
  );
  const binDir = join(fixtureRoot, "bin");
  const capturedArgsPath = join(fixtureRoot, "captured-args.json");
  const pnpmPath = join(binDir, "pnpm");

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      pnpmPath,
      [
        "#!/usr/bin/env node",
        'import { writeFileSync } from "node:fs";',
        "writeFileSync(",
        "  process.env.OPENMELD_CAPTURE_ARGS_PATH,",
        "  JSON.stringify(process.argv.slice(2)),",
        '  "utf8"',
        ");",
      ].join("\n"),
      "utf8"
    );
    await chmod(pnpmPath, 0o755);

    buildPackagedOpenMeldCli({
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        OPENMELD_CAPTURE_ARGS_PATH: capturedArgsPath,
      },
      repoRoot: fixtureRoot,
    });

    assert.deepEqual(JSON.parse(await readFile(capturedArgsPath, "utf8")), [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=openmeld",
      "--force",
    ]);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("collects local component release facts from the workspace shape", async () => {
  const repoRoot = await createFixtureRepo();
  try {
    const facts = await collectLocalComponentFacts({
      repoRoot,
      requireServiceBundle: true,
    });

    assert.equal(facts.cli.packageVersion, "1.2.3");
    assert.equal(facts.cli.commandContractVersion, "cli-contract-v1");
    assert.equal(facts.service.bundleVersion, "1.2.3");
    assert.equal(facts.service.runtimeContractEpoch, "daemon-epoch-v1");
    assert.equal(facts.service.serviceContractVersion, "daemon-epoch-v1");
    assert.match(facts.service.bundleHash, SHA256_HEX_REGEX);
    assert.equal(facts.skills.skillContractVersion, "skills-contract-v1");
    assert.deepEqual(facts.skills.skillIds, ["openmeld-cli"]);
    assert.match(facts.skills.bundleHash, SHA256_HEX_REGEX);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("computes the service bundle hash with the CLI daemon source-dist algorithm", async () => {
  const repoRoot = await createFixtureRepo();
  const serviceDistRoot = join(repoRoot, "clients/openmeld-cli/dist");
  try {
    await writeFixtureFile(serviceDistRoot, "dist-B6FL1Iut.js", "alpha\n");
    await writeFixtureFile(serviceDistRoot, "dist-B_Jt5y-0.js", "beta\n");
    await writeFixtureFile(serviceDistRoot, "nested/A.js", "gamma\n");
    await writeFixtureFile(serviceDistRoot, "nested/a.js", "delta\n");
    await writeFixtureFile(serviceDistRoot, "nested/-.js", "epsilon\n");
    await writeFixtureFile(serviceDistRoot, "nested/_.js", "zeta\n");

    const releaseHash = await computeServiceBundleHash({
      rootDir: serviceDistRoot,
    });
    const cliHash =
      await computeCliDaemonSourceDistFingerprint(serviceDistRoot);

    assert.equal(releaseHash, cliHash);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("ignores CLI-only artifacts when computing the service bundle hash", async () => {
  const repoRoot = await createFixtureRepo();
  const serviceDistRoot = join(repoRoot, "clients/openmeld-cli/dist");
  try {
    const baselineReleaseHash = await computeServiceBundleHash({
      rootDir: serviceDistRoot,
    });
    const baselineCliHash =
      await computeCliDaemonSourceDistFingerprint(serviceDistRoot);

    await writeFixtureFile(
      serviceDistRoot,
      "binary/openmeld-cli-darwin-arm64-1.2.3",
      "compiled binary\n"
    );
    await writeFixtureFile(
      serviceDistRoot,
      "binary/manifest.json",
      '{"schemaVersion":1}\n'
    );
    await writeFixtureFile(
      serviceDistRoot,
      "native/openmeld-keychain.node",
      "macOS secure storage addon\n"
    );

    const releaseHash = await computeServiceBundleHash({
      rootDir: serviceDistRoot,
    });
    const cliHash =
      await computeCliDaemonSourceDistFingerprint(serviceDistRoot);

    assert.equal(releaseHash, baselineReleaseHash);
    assert.equal(cliHash, baselineCliHash);
    assert.equal(releaseHash, cliHash);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("computes the skills bundle hash with the CLI runtime algorithm", async () => {
  const repoRoot = await createFixtureRepo();
  const skillsRoot = join(repoRoot, "clients/openmeld-cli/skills");
  try {
    await writeFixtureFile(skillsRoot, "README.md", "Bundled skills.\n");
    await writeFixtureFile(
      skillsRoot,
      ".openmeld-skill.json",
      '{"ignored":true}\n'
    );
    await writeFixtureFile(
      skillsRoot,
      "openmeld-cli/.openmeld-skill.json",
      '{"ignored":true}\n'
    );
    await writeFixtureFile(
      skillsRoot,
      "openmeld-cli/references/setup.md",
      "Setup\n"
    );

    const facts = await collectLocalComponentFacts({
      repoRoot,
      requireServiceBundle: true,
    });
    const cliHash = await computeCliSkillsBundleHash(skillsRoot);

    assert.equal(facts.skills.bundleHash, cliHash);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("builds a release policy manifest with required service and skills defaults", () => {
  const manifest = buildReleasePolicyManifest({
    facts: createFacts(),
    now: "2026-05-31T00:00:00.000Z",
    policies: { cli: "required" },
    reason: "setup handoff contract changed",
  });

  assert.equal(manifest.components.cli.updatePolicy, "required");
  assert.equal(manifest.components.service.updatePolicy, "required");
  assert.equal(manifest.components.skills.updatePolicy, "required");
  assert.equal(
    manifest.components.cli.reason,
    "setup handoff contract changed"
  );
});

test("verification allows advisory service and skill bundle updates", () => {
  const facts = createFacts();
  const manifest = buildReleasePolicyManifest({
    facts,
    now: "2026-05-31T00:00:00.000Z",
    policies: { cli: "available", service: "available", skills: "available" },
  });

  const errors = resolveReleasePolicyVerificationErrors({
    baseCommandContractVersion: "cli-contract-v1",
    baseRuntimeContractEpoch: "daemon-epoch-v1",
    baseServiceContractVersion: "daemon-epoch-v1",
    baseSkillContractVersion: "skills-contract-v1",
    changedPaths: [
      "clients/openmeld-cli/skills/openmeld-cli/SKILL.md",
      "runtime/local-service/src/local-execution-slots.ts",
    ],
    facts,
    manifest,
  });

  assert.deepEqual(errors, []);
});

test("strict verification rejects a stale Service bundle hash", () => {
  const baseFacts = createFacts();
  const manifest = buildReleasePolicyManifest({
    facts: baseFacts,
    now: "2026-05-31T00:00:00.000Z",
    policies: { cli: "available", service: "available", skills: "available" },
  });
  const currentFacts = createFacts({
    service: { bundleHash: "c".repeat(64) },
  });

  const errors = resolveReleasePolicyVerificationErrors({
    baseCommandContractVersion: "cli-contract-v1",
    baseRuntimeContractEpoch: "daemon-epoch-v1",
    baseServiceContractVersion: "daemon-epoch-v1",
    baseSkillContractVersion: "skills-contract-v1",
    changedPaths: ["runtime/local-service/src/native-delivery-service.ts"],
    facts: currentFacts,
    manifest,
  });

  assert.ok(
    errors.includes(
      `service.bundleHash is stale: manifest=${baseFacts.service.bundleHash} current=${currentFacts.service.bundleHash}`
    )
  );
});

test("verification requires policy intent for changed local component artifacts", () => {
  const facts = createFacts();
  const manifest = buildReleasePolicyManifest({
    facts,
    now: "2026-05-31T00:00:00.000Z",
    policies: { cli: "ok", service: "ok", skills: "ok" },
  });

  const errors = resolveReleasePolicyVerificationErrors({
    baseCommandContractVersion: "cli-contract-v1",
    baseRuntimeContractEpoch: "daemon-epoch-v1",
    baseServiceContractVersion: "daemon-epoch-v1",
    baseSkillContractVersion: "skills-contract-v1",
    changedPaths: [
      "clients/openmeld-cli/src/space/send.ts",
      "clients/openmeld-cli/skills/openmeld-cli/SKILL.md",
      "clients/openmeld-cli/src/local-service/dispatch/execute-dispatch-task.ts",
    ],
    facts,
    manifest,
  });

  assert.ok(
    errors.includes(
      "OpenMeld CLI package files changed, so cli.updatePolicy must be available or required."
    )
  );
  assert.ok(
    errors.includes(
      "OpenMeld skills changed, so skills.updatePolicy must be available or required."
    )
  );
  assert.ok(
    errors.includes(
      "OpenMeld Service carrier files changed, so service.updatePolicy must be available or required."
    )
  );
});

test("working-language prompt changes require CLI and Service release intent", () => {
  const facts = createFacts();
  const manifest = buildReleasePolicyManifest({
    facts,
    now: "2026-05-31T00:00:00.000Z",
    policies: { cli: "ok", service: "ok", skills: "ok" },
  });

  const errors = resolveReleasePolicyVerificationErrors({
    baseCommandContractVersion: "cli-contract-v1",
    baseRuntimeContractEpoch: "daemon-epoch-v1",
    baseServiceContractVersion: "daemon-epoch-v1",
    baseSkillContractVersion: "skills-contract-v1",
    changedPaths: ["packages/agent-runtime/src/working-language-prompt.ts"],
    facts,
    manifest,
  });

  assert.ok(
    errors.includes(
      "OpenMeld CLI package files changed, so cli.updatePolicy must be available or required."
    )
  );
  assert.ok(
    errors.includes(
      "OpenMeld Service carrier files changed, so service.updatePolicy must be available or required."
    )
  );
});

test("stamp refuses to preserve ok policy when changed paths require policy intent", async () => {
  const repoRoot = await createFixtureRepo();
  try {
    const facts = await collectLocalComponentFacts({
      repoRoot,
      requireServiceBundle: true,
    });
    await writeFixtureFile(
      repoRoot,
      "release/local-components.json",
      `${JSON.stringify(
        buildReleasePolicyManifest({
          facts,
          now: "2026-05-31T00:00:00.000Z",
          policies: { cli: "ok", service: "ok", skills: "ok" },
        }),
        null,
        2
      )}\n`
    );
    await initFixtureGitRepo(repoRoot);
    const base = await readGitHead(repoRoot);
    await writeFixtureFile(
      repoRoot,
      "clients/openmeld-cli/skills/openmeld-cli/SKILL.md",
      "# OpenMeld CLI\n\nUpdated instructions.\n"
    );
    await execGit(repoRoot, ["add", "."]);
    await execGit(repoRoot, ["commit", "-m", "Update skills"]);

    await assert.rejects(
      runLocalComponentsReleaseTool(
        [
          "stamp",
          "--repo-root",
          repoRoot,
          "--base",
          base,
          "--now",
          "2026-06-01T00:00:00.000Z",
        ],
        FIXTURE_STAMP_DEPENDENCIES
      ),
      SKILLS_POLICY_REQUIRED_RE
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("stamp rebuilds the packaged CLI before recording the Service bundle hash", async () => {
  const repoRoot = await createFixtureRepo();
  const serviceDistRoot = join(repoRoot, "clients/openmeld-cli/dist");
  try {
    await writeFixtureFile(
      repoRoot,
      ".gitignore",
      "clients/openmeld-cli/dist/\n"
    );
    await initFixtureGitRepo(repoRoot);
    const base = await readGitHead(repoRoot);
    const staleHash = await computeServiceBundleHash({
      rootDir: serviceDistRoot,
    });

    await runLocalComponentsReleaseTool(
      [
        "stamp",
        "--repo-root",
        repoRoot,
        "--base",
        base,
        "--cli",
        "available",
        "--service",
        "available",
        "--skills",
        "available",
        "--reason",
        "Advisory local component update",
        "--now",
        "2026-07-16T00:00:00.000Z",
      ],
      {
        buildPackagedOpenMeldCli: async () => {
          await rm(serviceDistRoot, { force: true, recursive: true });
          await writeFixtureFile(
            serviceDistRoot,
            "openmeld.js",
            "console.log('fresh packaged CLI')\n"
          );
        },
      }
    );

    const freshHash = await computeServiceBundleHash({
      rootDir: serviceDistRoot,
    });
    const manifest = JSON.parse(
      await readFile(join(repoRoot, "release/local-components.json"), "utf8")
    );
    assert.notEqual(freshHash, staleHash);
    assert.equal(manifest.components.service.bundleHash, freshHash);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("stamp --next writes the shared channel decision into the package and manifest", async () => {
  const repoRoot = await createFixtureRepo();
  try {
    await writeFixtureFile(
      repoRoot,
      ".gitignore",
      "clients/openmeld-cli/dist/\n"
    );
    await initFixtureGitRepo(repoRoot);
    const base = await readGitHead(repoRoot);

    await runLocalComponentsReleaseTool(
      [
        "stamp",
        "--repo-root",
        repoRoot,
        "--base",
        base,
        "--next",
        "--cli",
        "available",
        "--service",
        "available",
        "--skills",
        "available",
        "--reason",
        "Advisory local component update",
        "--now",
        "2026-07-17T00:00:00.000Z",
      ],
      {
        ...FIXTURE_STAMP_DEPENDENCIES,
        readCliReleaseChannels: async () => ({
          npmVersion: "1.2.3",
          r2Version: "1.2.3",
        }),
      }
    );

    const packageJson = JSON.parse(
      await readFile(
        join(repoRoot, "clients/openmeld-cli/package.json"),
        "utf8"
      )
    );
    const manifest = JSON.parse(
      await readFile(join(repoRoot, "release/local-components.json"), "utf8")
    );
    assert.equal(packageJson.version, "1.2.4");
    assert.equal(packageJson.openMeldReleaseDate, "2026-07-17");
    assert.equal(manifest.components.cli.packageVersion, "1.2.4");
    assert.equal(manifest.components.service.bundleVersion, "1.2.4");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("stamp restores the package version when a versioned build fails", async () => {
  const repoRoot = await createFixtureRepo();
  const packageJsonPath = join(repoRoot, "clients/openmeld-cli/package.json");
  try {
    await initFixtureGitRepo(repoRoot);
    const base = await readGitHead(repoRoot);
    const originalPackageJson = await readFile(packageJsonPath, "utf8");

    await assert.rejects(
      runLocalComponentsReleaseTool(
        [
          "stamp",
          "--repo-root",
          repoRoot,
          "--base",
          base,
          "--version",
          "1.2.4",
          "--cli",
          "available",
          "--service",
          "available",
          "--skills",
          "available",
        ],
        {
          buildPackagedOpenMeldCli: () => {
            throw new Error("build exploded");
          },
        }
      ),
      STAMP_BUILD_EXPLODED_RE
    );
    assert.equal(await readFile(packageJsonPath, "utf8"), originalPackageJson);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("stamp stops when release source changes during the packaged CLI build", async () => {
  const repoRoot = await createFixtureRepo();
  const manifestSourcePath = join(
    repoRoot,
    "clients/openmeld-cli/src/local-components/manifest.ts"
  );
  try {
    await writeFixtureFile(
      repoRoot,
      ".gitignore",
      "clients/openmeld-cli/dist/\n"
    );
    await initFixtureGitRepo(repoRoot);
    const base = await readGitHead(repoRoot);

    await assert.rejects(
      runLocalComponentsReleaseTool(
        [
          "stamp",
          "--repo-root",
          repoRoot,
          "--base",
          base,
          "--cli",
          "available",
          "--service",
          "available",
          "--skills",
          "available",
          "--reason",
          "Advisory local component update",
        ],
        {
          buildPackagedOpenMeldCli: async () => {
            const source = await readFile(manifestSourcePath, "utf8");
            await writeFile(
              manifestSourcePath,
              `${source}\n// Concurrent source change.\n`
            );
          },
        }
      ),
      STAMP_SOURCE_CHANGED_RE
    );
    await assert.rejects(
      readFile(join(repoRoot, "release/local-components.json"), "utf8"),
      { code: "ENOENT" }
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("stamp rejects the current-only verification bypass", async () => {
  const repoRoot = await createFixtureRepo();
  try {
    await initFixtureGitRepo(repoRoot);
    await assert.rejects(
      runLocalComponentsReleaseTool(
        [
          "stamp",
          "--repo-root",
          repoRoot,
          "--current",
          "--service",
          "available",
          "--reason",
          "Advisory local component update",
        ],
        FIXTURE_STAMP_DEPENDENCIES
      ),
      CURRENT_ONLY_STAMP_RE
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("stamp treats the first OpenMeld release as a greenfield baseline", async () => {
  const repoRoot = await createFixtureRepo();
  try {
    await writeFixtureFile(
      repoRoot,
      "clients/openmeld-cli/package.json",
      `${JSON.stringify(
        {
          version: "1.2.3",
          openmeld: { releaseLine: OPENMELD_GREENFIELD_RELEASE_LINE },
        },
        null,
        2
      )}\n`
    );
    await initFixtureGitRepo(repoRoot);

    await runLocalComponentsReleaseTool(
      [
        "stamp",
        "--repo-root",
        repoRoot,
        "--version",
        "1.2.4",
        "--cli",
        "available",
        "--service",
        "available",
        "--skills",
        "available",
        "--reason",
        "First OpenMeld release",
        "--now",
        "2026-08-12T00:00:00.000Z",
      ],
      FIXTURE_STAMP_DEPENDENCIES
    );

    const manifest = JSON.parse(
      await readFile(join(repoRoot, "release/local-components.json"), "utf8")
    );
    assert.equal(manifest.components.cli.packageVersion, "1.2.4");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("stamp rolls back its writes when final manifest verification fails", async () => {
  const repoRoot = await createFixtureRepo();
  const packageJsonPath = join(repoRoot, "clients/openmeld-cli/package.json");
  const manifestPath = join(repoRoot, "release/local-components.json");
  try {
    await writeFixtureFile(
      repoRoot,
      ".gitignore",
      "clients/openmeld-cli/dist/\n"
    );
    await writeFixtureFile(
      repoRoot,
      "clients/openmeld-cli/package.json",
      `${JSON.stringify(
        {
          version: "1.2.3",
          openmeld: { minRequiredCliVersion: "banana" },
        },
        null,
        2
      )}\n`
    );
    await initFixtureGitRepo(repoRoot);
    const base = await readGitHead(repoRoot);
    const originalPackageJson = await readFile(packageJsonPath, "utf8");

    await assert.rejects(
      runLocalComponentsReleaseTool(
        [
          "stamp",
          "--repo-root",
          repoRoot,
          "--base",
          base,
          "--cli",
          "available",
          "--service",
          "available",
          "--skills",
          "available",
          "--reason",
          "Advisory local component update",
        ],
        FIXTURE_STAMP_DEPENDENCIES
      ),
      INVALID_CLI_FLOOR_RE
    );
    assert.equal(await readFile(packageJsonPath, "utf8"), originalPackageJson);
    await assert.rejects(readFile(manifestPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("verification catches unstamped service, skill, and CLI contract changes", () => {
  const facts = createFacts({
    cli: { commandContractVersion: "cli-contract-v2" },
    service: {
      runtimeContractEpoch: "daemon-epoch-v2",
      serviceContractVersion: "daemon-epoch-v2",
    },
    skills: { skillContractVersion: "skills-contract-v2" },
  });
  const manifest = buildReleasePolicyManifest({
    facts,
    now: "2026-05-31T00:00:00.000Z",
    policies: { cli: "ok", service: "available", skills: "available" },
  });

  const errors = resolveReleasePolicyVerificationErrors({
    baseCommandContractVersion: "cli-contract-v1",
    baseRuntimeContractEpoch: "daemon-epoch-v1",
    baseServiceContractVersion: "daemon-epoch-v1",
    baseSkillContractVersion: "skills-contract-v1",
    changedPaths: [
      "clients/openmeld-cli/skills/openmeld-cli/SKILL.md",
      "runtime/local-service/src/local-execution-slots.ts",
    ],
    facts,
    manifest,
  });

  assert.ok(
    errors.includes(
      "OpenMeld Service runtime contract changed, so service.updatePolicy must be required."
    )
  );
  assert.ok(
    errors.includes(
      "OpenMeld Service contract changed, so service.updatePolicy must be required."
    )
  );
  assert.ok(
    errors.includes(
      "OpenMeld skills contract changed, so skills.updatePolicy must be required."
    )
  );
  assert.ok(
    errors.includes(
      "OpenMeld CLI command contract changed, so cli.updatePolicy must be required."
    )
  );
});

test("verification rejects a Service bundle hash restamp without a version bump", () => {
  const facts = createFacts({
    service: {
      bundleHash: "b".repeat(64),
      bundleVersion: "1.2.3",
    },
  });
  const manifest = buildReleasePolicyManifest({
    facts,
    now: "2026-06-01T00:00:00.000Z",
    policies: { cli: "available", service: "available", skills: "available" },
  });

  const errors = resolveReleasePolicyVerificationErrors({
    baseCommandContractVersion: "cli-contract-v1",
    baseRuntimeContractEpoch: "daemon-epoch-v1",
    baseServiceBundleHash: "a".repeat(64),
    baseServiceBundleVersion: "1.2.3",
    baseServiceContractVersion: "daemon-epoch-v1",
    baseSkillContractVersion: "skills-contract-v1",
    changedPaths: ["release/local-components.json"],
    facts,
    manifest,
  });

  assert.ok(
    errors.includes(
      "OpenMeld Service bundleHash changed without a service.bundleVersion bump."
    )
  );
});

test("verification allows a Service bundle hash change with a version bump", () => {
  const facts = createFacts({
    service: {
      bundleHash: "b".repeat(64),
      bundleVersion: "1.2.4",
    },
  });
  const manifest = buildReleasePolicyManifest({
    facts,
    now: "2026-06-01T00:00:00.000Z",
    policies: { cli: "available", service: "available", skills: "available" },
  });

  const errors = resolveReleasePolicyVerificationErrors({
    baseCommandContractVersion: "cli-contract-v1",
    baseRuntimeContractEpoch: "daemon-epoch-v1",
    baseServiceBundleHash: "a".repeat(64),
    baseServiceBundleVersion: "1.2.3",
    baseServiceContractVersion: "daemon-epoch-v1",
    baseSkillContractVersion: "skills-contract-v1",
    changedPaths: ["release/local-components.json"],
    facts,
    manifest,
  });

  assert.deepEqual(errors, []);
});

test("classifies release-sensitive paths narrowly", () => {
  assert.equal(
    isCliReleasePath("clients/openmeld-cli/src/space/send.ts"),
    true
  );
  assert.equal(isCliReleasePath("clients/openmeld-cli/package.json"), true);
  assert.equal(
    isCliReleasePath(
      "clients/openmeld-cli/native/macos-keychain/src/openmeld_keychain.mm"
    ),
    true
  );
  assert.equal(
    isServiceReleasePath(
      "clients/openmeld-cli/native/macos-keychain/src/openmeld_keychain.mm"
    ),
    false
  );
  assert.equal(
    isCliReleasePath(
      "clients/openmeld-cli/scripts/build-macos-keychain-addon.mjs"
    ),
    true
  );
  assert.equal(
    isServiceReleasePath(
      "clients/openmeld-cli/scripts/build-macos-keychain-addon.mjs"
    ),
    false
  );
  assert.equal(isCliReleasePath("release/vendor-models.json"), true);
  assert.equal(isServiceReleasePath("release/vendor-models.json"), true);
  assert.equal(isServiceReleasePath("release/local-components.json"), false);
  assert.equal(
    isCliReleasePath("runtime/adapters/core/src/launch-contract.ts"),
    true
  );
  assert.equal(
    isCliReleasePath("clients/openmeld-cli/skills/openmeld-cli/SKILL.md"),
    false
  );
  assert.equal(
    isSkillsReleasePath("clients/openmeld-cli/skills/openmeld-cli/SKILL.md"),
    true
  );
  assert.equal(
    isServiceReleasePath(
      "clients/openmeld-cli/src/local-service/dispatch/execute-dispatch-task.ts"
    ),
    true
  );
  assert.equal(
    isServiceReleasePath("runtime/local-service/src/local-execution-slots.ts"),
    true
  );
  assert.equal(
    isServiceReleasePath("runtime/adapters/core/src/launch-contract.ts"),
    true
  );
  assert.equal(
    isServiceReleasePath("runtime/adapters/core/test/launch-contract.test.js"),
    false
  );
  assert.equal(
    isServiceReleasePath("runtime/local-service/package.json"),
    true
  );
  assert.equal(
    isServiceReleasePath(
      "packages/schemas/src/schemas/http/organization-documents.ts"
    ),
    true
  );
  assert.equal(
    isServiceReleasePath(
      "clients/openmeld-cli/src/local-service/lifecycle/daemon-service-runtime.ts"
    ),
    true
  );
  assert.equal(
    isServiceReleasePath(
      "clients/openmeld-cli/src/daemon/dispatch/execute-dispatch-task.ts"
    ),
    false
  );
  assert.equal(
    isServiceReleasePath("clients/web/src/components/agents/agents-page.tsx"),
    false
  );
});

test("resolves base-aware verification by default", () => {
  assert.equal(resolveEffectiveReleaseBase({ env: {} }), "origin/main");
  assert.equal(
    resolveEffectiveReleaseBase({
      env: { OPENMELD_AFFECTED_BASE: "upstream/main" },
    }),
    "upstream/main"
  );
  assert.equal(
    resolveEffectiveReleaseBase({
      base: "release-base",
      env: { OPENMELD_AFFECTED_BASE: "upstream/main" },
    }),
    "release-base"
  );
  assert.equal(
    resolveEffectiveReleaseBase({
      currentOnly: true,
      env: { OPENMELD_AFFECTED_BASE: "upstream/main" },
    }),
    null
  );
});

test("prefers the latest release tag over origin/main as the release base", () => {
  // The tag marks the last actually-published state; origin/main can lag a
  // batched-push workflow arbitrarily far (the F1 floor regression root).
  assert.equal(
    resolveEffectiveReleaseBase({ env: {}, latestReleaseTag: "v0.7.96" }),
    "v0.7.96"
  );
  // Explicit --base and env overrides still win over the tag.
  assert.equal(
    resolveEffectiveReleaseBase({
      base: "release-base",
      env: {},
      latestReleaseTag: "v0.7.96",
    }),
    "release-base"
  );
  assert.equal(
    resolveEffectiveReleaseBase({
      env: { OPENMELD_AFFECTED_BASE: "upstream/main" },
      latestReleaseTag: "v0.7.96",
    }),
    "upstream/main"
  );
  assert.equal(
    resolveEffectiveReleaseBase({
      base: "release-base",
      currentReleaseLine: OPENMELD_GREENFIELD_RELEASE_LINE,
      env: { OPENMELD_AFFECTED_BASE: "upstream/main" },
      latestReleaseTag: null,
    }),
    "release-base"
  );
  // No tag yet (pre-tagging history) falls back to origin/main.
  assert.equal(
    resolveEffectiveReleaseBase({ env: {}, latestReleaseTag: null }),
    "origin/main"
  );
  // OpenMeld greenfield keeps ATS Git history but has no published OpenMeld
  // local-components baseline until the first OpenMeld release tag exists.
  assert.equal(
    resolveEffectiveReleaseBase({
      currentReleaseLine: OPENMELD_GREENFIELD_RELEASE_LINE,
      env: {},
      latestReleaseTag: null,
    }),
    null
  );
  assert.equal(
    resolveEffectiveReleaseBase({
      currentReleaseLine: OPENMELD_GREENFIELD_RELEASE_LINE,
      env: { OPENMELD_AFFECTED_BASE: "origin/main" },
      latestReleaseTag: null,
    }),
    null
  );
});

test("resolves the latest OpenMeld release tag from git history", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "openmeld-release-tag-"));
  const git = (...args) =>
    execGit(repoRoot, [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      ...args,
    ]);
  try {
    await git("init");
    await git("commit", "--allow-empty", "-m", "first");
    assert.equal(await resolveLatestReleaseTag({ repoRoot }), null);

    // Non-release tags must not match the v[0-9]* pattern.
    await git("tag", "-a", "vendor-drop", "-m", "vendor-drop");
    assert.equal(await resolveLatestReleaseTag({ repoRoot }), null);

    await git("tag", "-a", "v0.8.0", "-m", "Release ATS CLI 0.8.0");
    assert.equal(await resolveLatestReleaseTag({ repoRoot }), null);

    await writeFixtureFile(
      repoRoot,
      "clients/openmeld-cli/package.json",
      `${JSON.stringify(
        {
          version: "0.1.0",
          openmeld: { releaseLine: OPENMELD_GREENFIELD_RELEASE_LINE },
        },
        null,
        2
      )}\n`
    );
    await git("add", ".");
    await git("commit", "-m", "Declare OpenMeld release line");
    await git("tag", "-a", "v0.1.0", "-m", "Release OpenMeld CLI 0.1.0");
    assert.equal(await resolveLatestReleaseTag({ repoRoot }), "v0.1.0");
    assert.equal(
      await withPollutedGitEnv(() => resolveLatestReleaseTag({ repoRoot })),
      "v0.1.0"
    );

    await git("commit", "--allow-empty", "-m", "second");
    await git("tag", "-a", "v0.1.1", "-m", "Release OpenMeld CLI 0.1.1");
    assert.equal(await resolveLatestReleaseTag({ repoRoot }), "v0.1.1");
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("collects the published CLI required floor without leaking it into the manifest", async () => {
  const repoRoot = await createFixtureRepo();
  try {
    await writeFixtureFile(
      repoRoot,
      "clients/openmeld-cli/package.json",
      `${JSON.stringify(
        { version: "1.2.3", openmeld: { minRequiredCliVersion: "1.0.0" } },
        null,
        2
      )}\n`
    );
    const facts = await collectLocalComponentFacts({
      repoRoot,
      requireServiceBundle: true,
    });
    assert.equal(facts.cliRequiredFloor, "1.0.0");
    const manifest = buildReleasePolicyManifest({
      facts,
      now: "2026-06-01T00:00:00.000Z",
      policies: { cli: "available" },
    });
    assert.equal("minRequiredCliVersion" in manifest.components.cli, false);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("stamp projects the CLI floor for required releases and carries it forward", async () => {
  const repoRoot = await createFixtureRepo();
  const packageJsonPath = join(repoRoot, "clients/openmeld-cli/package.json");
  try {
    await initFixtureGitRepo(repoRoot);
    const base = await readGitHead(repoRoot);
    const dependencies = FIXTURE_STAMP_DEPENDENCIES;
    await runLocalComponentsReleaseTool(
      [
        "stamp",
        "--repo-root",
        repoRoot,
        "--base",
        base,
        "--cli",
        "required",
        "--reason",
        "CLI command contract bump",
        "--now",
        "2026-06-01T00:00:00.000Z",
      ],
      dependencies
    );
    const stamped = JSON.parse(await readFile(packageJsonPath, "utf8"));
    assert.equal(stamped.openmeld.minRequiredCliVersion, "1.2.3");

    await runLocalComponentsReleaseTool(
      [
        "stamp",
        "--repo-root",
        repoRoot,
        "--base",
        base,
        "--cli",
        "available",
        "--reason",
        "Advisory fix",
        "--now",
        "2026-06-02T00:00:00.000Z",
      ],
      dependencies
    );
    const carried = JSON.parse(await readFile(packageJsonPath, "utf8"));
    assert.equal(carried.openmeld.minRequiredCliVersion, "1.2.3");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("flags a CLI floor that drifts from the required policy", () => {
  const facts = createFacts();
  const requiredManifest = buildReleasePolicyManifest({
    facts,
    now: "2026-06-01T00:00:00.000Z",
    policies: { cli: "required" },
  });
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      facts: { cliRequiredFloor: null },
      manifest: requiredManifest,
    }),
    [
      "cli.updatePolicy is required, so clients/openmeld-cli/package.json must set openmeld.minRequiredCliVersion to 1.2.3.",
    ]
  );
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      facts: { cliRequiredFloor: "1.0.0" },
      manifest: requiredManifest,
    }),
    [
      "cli.updatePolicy is required, so openmeld.minRequiredCliVersion (1.0.0) must be at least the published cli.packageVersion (1.2.3).",
    ]
  );
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      facts: { cliRequiredFloor: "1.2.3" },
      manifest: requiredManifest,
    }),
    []
  );
});

test("flags a CLI floor that exceeds the published version and allows no floor otherwise", () => {
  const facts = createFacts();
  const availableManifest = buildReleasePolicyManifest({
    facts,
    now: "2026-06-01T00:00:00.000Z",
    policies: { cli: "available" },
  });
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      facts: { cliRequiredFloor: "2.0.0" },
      manifest: availableManifest,
    }),
    [
      "openmeld.minRequiredCliVersion (2.0.0) must not exceed the published cli.packageVersion (1.2.3).",
    ]
  );
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      facts: { cliRequiredFloor: null },
      manifest: availableManifest,
    }),
    []
  );
});

test("the CLI floor is monotonic for non-required releases (base-aware)", () => {
  const facts = createFacts();
  const availableManifest = buildReleasePolicyManifest({
    facts,
    now: "2026-06-01T00:00:00.000Z",
    policies: { cli: "available" },
  });

  // Deliberately RAISING the floor outside a required release is allowed: it
  // stays dormant until the next required release, which pins the floor to
  // its own version regardless.
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "1.1.0",
      facts: { cliRequiredFloor: "1.2.0" },
      manifest: availableManifest,
    }),
    []
  );
  // Dropping it (silently un-gating older CLIs) is rejected.
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "1.1.0",
      facts: { cliRequiredFloor: null },
      manifest: availableManifest,
    }),
    [
      "cli.updatePolicy is available, so openmeld.minRequiredCliVersion (unset) must not regress below the base floor (1.1.0).",
    ]
  );
  // Carrying it forward unchanged is allowed.
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "1.1.0",
      facts: { cliRequiredFloor: "1.1.0" },
      manifest: availableManifest,
    }),
    []
  );
  // Introducing a brand-new floor without a base floor is a raise from
  // nothing — allowed for the same reason.
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: null,
      facts: { cliRequiredFloor: "1.2.0" },
      manifest: availableManifest,
    }),
    []
  );
});

test("the CLI floor never regresses below the base floor (monotonicity)", () => {
  const facts = createFacts();
  // The exact 0.7.95 incident shape: an `available` release shipping a floor
  // LOWER than the base ref's committed floor would silently un-gate older
  // CLIs. The verify gate must reject it.
  const availableManifest = buildReleasePolicyManifest({
    facts,
    now: "2026-06-01T00:00:00.000Z",
    policies: { cli: "available" },
  });
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "1.1.0",
      facts: { cliRequiredFloor: "1.0.0" },
      manifest: availableManifest,
    }),
    [
      "cli.updatePolicy is available, so openmeld.minRequiredCliVersion (1.0.0) must not regress below the base floor (1.1.0).",
    ]
  );
  // A required release may raise the floor but must never drop it below what
  // the base ref already committed either.
  const requiredManifest = buildReleasePolicyManifest({
    facts,
    now: "2026-06-01T00:00:00.000Z",
    policies: { cli: "required" },
  });
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "1.3.0",
      facts: { cliRequiredFloor: "1.2.3" },
      manifest: requiredManifest,
    }),
    [
      "openmeld.minRequiredCliVersion (1.2.3) must not regress below the base floor (1.3.0).",
    ]
  );
});

test("the CLI floor may reset only for the initial OpenMeld release line", () => {
  const facts = {
    ...createFacts(),
    cliRequiredFloor: null,
    cliReleaseLine: "openmeld-greenfield-2026-07",
  };
  const laterLineFacts = {
    ...facts,
    cliReleaseLine: "openmeld-next-release-line",
  };
  const availableManifest = buildReleasePolicyManifest({
    facts,
    now: "2026-07-04T00:00:00.000Z",
    policies: { cli: "available" },
  });
  const laterLineManifest = buildReleasePolicyManifest({
    facts: laterLineFacts,
    now: "2026-07-04T00:00:00.000Z",
    policies: { cli: "available" },
  });

  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "0.7.94",
      baseReleaseLine: null,
      facts,
      manifest: availableManifest,
    }),
    []
  );

  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "0.7.94",
      baseReleaseLine: null,
      facts: laterLineFacts,
      manifest: laterLineManifest,
    }),
    [
      "cli.updatePolicy is available, so openmeld.minRequiredCliVersion (unset) must not regress below the base floor (0.7.94).",
    ]
  );

  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "0.7.94",
      baseReleaseLine: "openmeld-greenfield-2026-07",
      facts,
      manifest: availableManifest,
    }),
    [
      "cli.updatePolicy is available, so openmeld.minRequiredCliVersion (unset) must not regress below the base floor (0.7.94).",
    ]
  );
});

test("skips the base-aware drift check when the base floor is untrustworthy", () => {
  const facts = createFacts();
  const availableManifest = buildReleasePolicyManifest({
    facts,
    now: "2026-06-01T00:00:00.000Z",
    policies: { cli: "available" },
  });
  // A malformed base floor must not fail a legitimate carry-forward release
  // with a confusing message; treat it as no reliable base signal.
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "banana",
      facts: { cliRequiredFloor: "1.1.0" },
      manifest: availableManifest,
    }),
    []
  );
});

test("a required release may raise the floor but never regress it (base-aware)", () => {
  const facts = createFacts();
  const requiredManifest = buildReleasePolicyManifest({
    facts,
    now: "2026-06-01T00:00:00.000Z",
    policies: { cli: "required" },
  });
  // Raising from a lower base floor to the published version is allowed.
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "1.0.0",
      facts: { cliRequiredFloor: "1.2.3" },
      manifest: requiredManifest,
    }),
    []
  );
  // A required release whose floor sits below an existing higher base floor
  // is a regression.
  assert.deepEqual(
    resolveCliRequiredFloorVerificationErrors({
      baseAware: true,
      baseFloor: "2.0.0",
      facts: { cliRequiredFloor: "1.2.3" },
      manifest: requiredManifest,
    }),
    [
      "openmeld.minRequiredCliVersion (1.2.3) must not regress below the base floor (2.0.0).",
    ]
  );
});

test("rejects a non-plain CLI floor outright", () => {
  const facts = createFacts();
  const availableManifest = buildReleasePolicyManifest({
    facts,
    now: "2026-06-01T00:00:00.000Z",
    policies: { cli: "available" },
  });
  // Garbage, build metadata (compared-away by the core comparator), and
  // prerelease floors are all rejected: a floor must be a plain release version.
  for (const badFloor of ["1.2.3oops", "9.0.0+bad meta", "1.2.3-alpha.1"]) {
    assert.deepEqual(
      resolveCliRequiredFloorVerificationErrors({
        facts: { cliRequiredFloor: badFloor },
        manifest: availableManifest,
      }),
      [
        `clients/openmeld-cli/package.json openmeld.minRequiredCliVersion is not a valid version: ${badFloor}`,
      ]
    );
  }
});

async function createFixtureRepo() {
  const repoRoot = await mkdtemp(join(tmpdir(), "openmeld-local-components-"));
  await writeFixtureFile(
    repoRoot,
    "clients/openmeld-cli/package.json",
    `${JSON.stringify({ version: "1.2.3" }, null, 2)}\n`
  );
  await writeFixtureFile(
    repoRoot,
    "clients/openmeld-cli/src/local-components/manifest.ts",
    [
      'export const OPENMELD_CLI_COMMAND_CONTRACT_VERSION = "cli-contract-v1";',
      'export const OPENMELD_SKILLS_CONTRACT_VERSION = "skills-contract-v1";',
      "export const OPENMELD_SERVICE_CONTRACT_VERSION = CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH;",
      "",
    ].join("\n")
  );
  await writeFixtureFile(
    repoRoot,
    "packages/schemas/src/schemas/daemon/runtime-transport.ts",
    'export const CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH = "daemon-epoch-v1" as const;\n'
  );
  await writeFixtureFile(
    repoRoot,
    "clients/openmeld-cli/skills/openmeld-cli/SKILL.md",
    "# OpenMeld CLI\n"
  );
  await writeFixtureFile(
    repoRoot,
    "clients/openmeld-cli/dist/openmeld.js",
    "console.log('openmeld')\n"
  );
  return repoRoot;
}

async function initFixtureGitRepo(repoRoot) {
  await execGit(repoRoot, ["init"]);
  await execGit(repoRoot, ["config", "user.email", "openmeld@example.com"]);
  await execGit(repoRoot, ["config", "user.name", "OpenMeld Test"]);
  await execGit(repoRoot, ["add", "."]);
  await execGit(repoRoot, ["commit", "-m", "Initial fixture"]);
}

async function readGitHead(repoRoot) {
  const result = await execGit(repoRoot, ["rev-parse", "HEAD"]);
  return result.stdout.trim();
}

async function execGit(repoRoot, args) {
  return await execFileAsync("git", args, {
    cwd: repoRoot,
    env: buildIsolatedGitEnv({ ...process.env, ...GIT_HOOK_ENV }),
    maxBuffer: 1024 * 1024,
  });
}

function buildIsolatedGitEnv(env) {
  const isolatedEnv = { ...env };
  for (const name of [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_CONFIG",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_GLOBAL",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_PREFIX",
    "GIT_WORK_TREE",
  ]) {
    delete isolatedEnv[name];
  }
  for (const name of Object.keys(isolatedEnv)) {
    if (
      name.startsWith("GIT_CONFIG_KEY_") ||
      name.startsWith("GIT_CONFIG_VALUE_")
    ) {
      delete isolatedEnv[name];
    }
  }
  return isolatedEnv;
}

async function withPollutedGitEnv(callback) {
  const previousValues = new Map();
  for (const [name, value] of Object.entries(GIT_HOOK_ENV)) {
    previousValues.set(
      name,
      Object.hasOwn(process.env, name) ? process.env[name] : undefined
    );
    process.env[name] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [name, value] of previousValues) {
      if (value === undefined) {
        delete process.env[name];
        continue;
      }
      process.env[name] = value;
    }
  }
}

async function writeFixtureFile(repoRoot, relativePath, content) {
  const path = join(repoRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function computeCliDaemonSourceDistFingerprint(sourceDistRootPath) {
  const filePaths = await listCliDaemonSourceDistFiles(sourceDistRootPath);
  const hash = createHash("sha256");
  for (const filePath of filePaths) {
    const relativePath = relative(sourceDistRootPath, filePath).replaceAll(
      "\\",
      "/"
    );
    hash.update(relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(await readFile(filePath));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

async function computeCliSkillsBundleHash(skillsRootPath) {
  const files = await listCliSkillsBundleFiles({
    currentDir: skillsRootPath,
    ignoredNames: new Set([".openmeld-skill.json"]),
    rootDir: skillsRootPath,
  });
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`file:${file.relativePath}\n`);
    hash.update(await readFile(file.absolutePath));
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function listCliSkillsBundleFiles(input) {
  const entries = await readdir(input.currentDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    if (input.ignoredNames.has(entry.name)) {
      continue;
    }
    const absolutePath = join(input.currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await listCliSkillsBundleFiles({
          ...input,
          currentDir: absolutePath,
        }))
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push({
      absolutePath,
      relativePath: relative(input.rootDir, absolutePath).replaceAll("\\", "/"),
    });
  }
  return files;
}

async function listCliDaemonSourceDistFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const filePaths = [];
  for (const entry of entries) {
    if (entry.name === "binary" || entry.name === "native") {
      continue;
    }
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...(await listCliDaemonSourceDistFiles(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      filePaths.push(entryPath);
    }
  }
  return filePaths.sort(compareCodeUnitText);
}

function compareCodeUnitText(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function createFacts(overrides = {}) {
  return {
    cli: {
      commandContractVersion:
        overrides.cli?.commandContractVersion ?? "cli-contract-v1",
      packageVersion: "1.2.3",
    },
    service: {
      bundleHash: overrides.service?.bundleHash ?? "a".repeat(64),
      bundleVersion: overrides.service?.bundleVersion ?? "1.2.3",
      runtimeContractEpoch:
        overrides.service?.runtimeContractEpoch ?? "daemon-epoch-v1",
      serviceContractVersion:
        overrides.service?.serviceContractVersion ?? "daemon-epoch-v1",
    },
    skills: {
      bundleHash: overrides.skills?.bundleHash ?? "b".repeat(64),
      skillContractVersion:
        overrides.skills?.skillContractVersion ?? "skills-contract-v1",
      skillIds: ["openmeld-cli"],
    },
  };
}
