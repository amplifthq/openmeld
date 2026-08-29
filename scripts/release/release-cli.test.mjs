import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { createTrustedGitEnvironment } from "../ci/trusted-git-network.mjs";

import {
  assertChannelReadyForVersionOnlyRelease,
  assertCliReleaseVersionTarget,
  buildCoreDeployStepSpec,
  buildPreTagCliReleaseStepSpecs,
  formatDirtyWorktreeReleaseError,
  parseCliReleaseArgs,
  parseGitStatusPorcelain,
  publishCliReleaseTag,
  resolveCliReleaseTagName,
  runCliRelease,
  tagCliRelease,
} from "./release-cli.mjs";
import {
  probeCliReleaseStages,
  resolveCoreProjectionTag,
} from "./release-cli-resume.mjs";

const execFileAsync = promisify(execFile);

const CLI_RELEASE_REFUSED_RE = /CLI release refused/u;
const DEPLOYS_CORE_RE = /deploys Core/u;
const HALF_FINISHED_CORE_RE = /half-finished Core/u;
const AGENT_STOP_RE = /Agents: stop here and ask the user/u;
const CHANNEL_CLI_VERSION_RE = /0\.7\.95/u;
const TAG_CONFLICT_RE = /must map to exactly one commit/u;
const IMMUTABLE_TAG_CONFLICT_RE =
  /refusing to overwrite an immutable release tag/u;
const IMMUTABLE_NPM_METADATA_RE =
  /npm openmeld@0\.7\.96 is immutable with required floor 0\.7\.95/u;
const IMMUTABLE_R2_METADATA_RE =
  /production CLI manifest for 0\.7\.96 is immutable with required floor 0\.7\.95/u;
const IMMUTABLE_R2_ARTIFACT_RE =
  /production CLI manifest already publishes 0\.3\.130.*raw artifact is not downloadable/u;
const INCONCLUSIVE_R2_PROBE_RE =
  /could not prove whether 0\.3\.130 is already published.*refusing to rerun immutable binary publication/u;
const R2_STABLE_CHANNEL_AHEAD_RE =
  /production CLI manifest is already at 0\.3\.132, ahead of target 0\.3\.131.*stable channel backward/u;
const MANIFEST_GATE_EXPLODED_RE = /manifest gate exploded/u;
const QUEUE_GATE_EXPLODED_RE = /queue gate exploded/u;
const RELEASE_RESUME_COMMAND_RE =
  /pnpm run release:deploy:local -- --scope cli/u;
const DECLARED_CLI_VERSION_RE = /0\.7\.96/u;
const ENOTFOUND_RE = /ENOTFOUND/u;
const UNKNOWN_RELEASE_ARG_RE = /Unknown CLI release/u;
const WITH_BINARY_FLAG_RE = /--with-binary/u;
const VERSION_FLAGS_MUTUALLY_EXCLUSIVE_RE =
  /--next and --version are mutually exclusive/u;
const VERSION_GUARD_SELECTED_RE = /selected 0\.7\.97/u;
const VERSION_GUARD_STAMP_COMMAND_RE =
  /release:local-components plan --version/u;
const RELEASE_PREFLIGHT_COMMAND_RE = /pnpm run release:preflight/u;
const ALREADY_DONE_RE = /SKIP \(already done/u;
const THREE_WAY_ALIGNMENT_RE = /R2, npm, and the active Core projection/u;
const WRANGLER_RELEASE_STATE = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/wrangler-worker-release-state-4.110.0.json",
      import.meta.url
    ),
    "utf8"
  )
);
const NPM_VERSION_FLOOR_FIXTURE = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/npm-view-openmeld-0.3.130-version-floor.json",
      import.meta.url
    ),
    "utf8"
  )
);
const TEST_CLI_BINARY = Buffer.alloc(100, "b");
const TEST_CLI_ARCHIVE = gzipSync(TEST_CLI_BINARY);

function buildCapturedNpmVersionFloorStdout(input) {
  return `${JSON.stringify({
    ...NPM_VERSION_FLOOR_FIXTURE.response,
    version: input.version,
    "openmeld.minRequiredCliVersion": input.minRequiredCliVersion,
  })}\n`;
}

function buildTestCliManifest(version, options = {}) {
  const url = `https://openmeld.test/cli-${version}`;
  return {
    channels: {
      stable: {
        minRequiredCliVersion: options.minRequiredCliVersion ?? version,
        platforms: {
          "darwin-arm64": {
            sha256: createHash("sha256").update(TEST_CLI_BINARY).digest("hex"),
            sizeBytes: TEST_CLI_BINARY.byteLength,
            url,
            ...(options.compressed === false
              ? {}
              : {
                  archiveFormat: "gzip",
                  archiveSha256: createHash("sha256")
                    .update(TEST_CLI_ARCHIVE)
                    .digest("hex"),
                  archiveSizeBytes: TEST_CLI_ARCHIVE.byteLength,
                  archiveUrl: `${url}.gz`,
                }),
          },
        },
        version,
      },
    },
    schemaVersion: 1,
  };
}

async function createReleaseRepo(version, options = {}) {
  const repoRoot = await mkdtemp(join(tmpdir(), "openmeld-release-cli-"));
  const git = (...args) =>
    execFileAsync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
      { cwd: repoRoot }
    );
  await git("init");
  // Persist identity so git subprocesses spawned by the release script itself
  // (tag creation, pushes) can commit on runners without a global gitconfig.
  await git("config", "user.name", "t");
  await git("config", "user.email", "t@example.com");
  await mkdir(join(repoRoot, "clients/openmeld-cli"), { recursive: true });
  await writeFile(
    join(repoRoot, "clients/openmeld-cli/package.json"),
    `${JSON.stringify(
      {
        name: "openmeld",
        version,
        openmeld: {
          minRequiredCliVersion: options.minRequiredCliVersion ?? version,
        },
      },
      null,
      2
    )}\n`
  );
  await git("add", "-A");
  await git("commit", "-m", "seed");
  return { git, repoRoot };
}

async function configureTestOrigin(input) {
  const remoteRoot = join(input.repoRoot, ".git", "test-origin.git");
  await input.git("init", "--bare", "--initial-branch=main", remoteRoot);
  await input.git("remote", "add", "origin", remoteRoot);
  await input.git("push", "origin", "HEAD:refs/heads/main");
}

test("parses porcelain status output for release safety checks", () => {
  assert.deepEqual(
    parseGitStatusPorcelain(
      [
        " M services/core/src/start/application/current-device-target-service.ts",
        "?? developing/product/agent-model-selection.md",
        "",
      ].join("\n")
    ),
    [
      " M services/core/src/start/application/current-device-target-service.ts",
      "?? developing/product/agent-model-selection.md",
    ]
  );
});

test("explains why agents must not release CLI from a dirty worktree", () => {
  const message = formatDirtyWorktreeReleaseError([
    " M services/core/src/start/application/current-device-target-service.ts",
  ]);

  assert.match(message, CLI_RELEASE_REFUSED_RE);
  assert.match(message, DEPLOYS_CORE_RE);
  assert.match(message, HALF_FINISHED_CORE_RE);
  assert.match(message, AGENT_STOP_RE);
});

test("keeps CLI binary publishing opt-in for release:cli", () => {
  assert.deepEqual(parseCliReleaseArgs([]), {
    next: false,
    version: null,
    withBinary: false,
  });
  assert.deepEqual(parseCliReleaseArgs(["--with-binary"]), {
    next: false,
    version: null,
    withBinary: true,
  });
  assert.throws(
    () => parseCliReleaseArgs(["--binary"]),
    UNKNOWN_RELEASE_ARG_RE
  );
});

test("parses explicit and automatic CLI release version guards", () => {
  assert.deepEqual(parseCliReleaseArgs(["--version", "0.7.97"]), {
    next: false,
    version: "0.7.97",
    withBinary: false,
  });
  assert.deepEqual(parseCliReleaseArgs(["--next", "--with-binary"]), {
    next: true,
    version: null,
    withBinary: true,
  });
  assert.throws(
    () => parseCliReleaseArgs(["--next", "--version", "0.7.97"]),
    VERSION_FLAGS_MUTUALLY_EXCLUSIVE_RE
  );
});

test("requires the selected release version to match package and manifest truth", async () => {
  const { repoRoot } = await createReleaseRepo("0.7.96");
  try {
    await mkdir(join(repoRoot, "release"), { recursive: true });
    await writeFile(
      join(repoRoot, "release/local-components.json"),
      `${JSON.stringify(
        {
          components: {
            cli: { packageVersion: "0.7.96" },
            service: { bundleVersion: "0.7.96" },
          },
        },
        null,
        2
      )}\n`
    );

    assert.doesNotThrow(() =>
      assertCliReleaseVersionTarget({
        cwd: repoRoot,
        targetVersion: "0.7.96",
      })
    );
    assert.throws(
      () =>
        assertCliReleaseVersionTarget({
          cwd: repoRoot,
          targetVersion: "0.7.97",
        }),
      (error) => {
        assert.match(error.message, VERSION_GUARD_SELECTED_RE);
        assert.match(error.message, VERSION_GUARD_STAMP_COMMAND_RE);
        assert.match(error.message, RELEASE_PREFLIGHT_COMMAND_RE);
        return true;
      }
    );
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("adds the binary upload step only when release:cli opts in", () => {
  assert.deepEqual(
    buildPreTagCliReleaseStepSpecs({ withBinary: false }).map(
      (step) => step.label
    ),
    [
      "Verify local-components release manifest",
      "Verify production Core Queue resources",
      "Publish OpenMeld CLI to npm",
    ]
  );
  assert.deepEqual(
    buildPreTagCliReleaseStepSpecs({ withBinary: true }).map(
      (step) => step.label
    ),
    [
      "Verify local-components release manifest",
      "Verify production Core Queue resources",
      "Build and upload OpenMeld CLI binary",
      "Publish OpenMeld CLI to npm",
    ]
  );
});

test("verifies production Queues before any irreversible CLI release step", () => {
  const steps = buildPreTagCliReleaseStepSpecs({ withBinary: true });
  const queueVerificationIndex = steps.findIndex(
    (step) => step.label === "Verify production Core Queue resources"
  );
  const binaryUploadIndex = steps.findIndex(
    (step) => step.label === "Build and upload OpenMeld CLI binary"
  );
  const npmPublishIndex = steps.findIndex(
    (step) => step.label === "Publish OpenMeld CLI to npm"
  );

  assert.ok(queueVerificationIndex >= 0);
  assert.ok(queueVerificationIndex < binaryUploadIndex);
  assert.ok(queueVerificationIndex < npmPublishIndex);
  assert.deepEqual(steps[queueVerificationIndex]?.args, [
    "run",
    "verify:cloudflare:production-queues",
    "--",
    "services/core/wrangler.jsonc",
  ]);
});

test("derives the release tag name from the published CLI version", async () => {
  const { repoRoot } = await createReleaseRepo("0.7.96");
  try {
    assert.equal(resolveCliReleaseTagName({ cwd: repoRoot }), "v0.7.96");
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("tags the release at HEAD and stays idempotent on reruns", async () => {
  const { git, repoRoot } = await createReleaseRepo("0.7.96");
  try {
    assert.deepEqual(tagCliRelease({ cwd: repoRoot }), {
      created: true,
      tagName: "v0.7.96",
    });
    // A rerun at the same commit (e.g. recovering a failed Core deploy) must
    // reuse the tag instead of failing the release.
    assert.deepEqual(tagCliRelease({ cwd: repoRoot }), {
      created: false,
      tagName: "v0.7.96",
    });
    const tagged = await git("rev-parse", "v0.7.96^{commit}");
    const head = await git("rev-parse", "HEAD");
    assert.equal(tagged.stdout.trim(), head.stdout.trim());
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("publishes the immutable release tag to origin and stays idempotent", async () => {
  const { git, repoRoot } = await createReleaseRepo("0.7.96");
  try {
    await configureTestOrigin({ git, repoRoot });
    assert.deepEqual(publishCliReleaseTag({ cwd: repoRoot }), {
      created: true,
      published: true,
      tagName: "v0.7.96",
    });
    assert.deepEqual(publishCliReleaseTag({ cwd: repoRoot }), {
      created: false,
      published: true,
      tagName: "v0.7.96",
    });
    const head = (await git("rev-parse", "HEAD")).stdout.trim();
    const remoteTag = (
      await git(
        "--git-dir=.git/test-origin.git",
        "rev-parse",
        "refs/tags/v0.7.96^{commit}"
      )
    ).stdout.trim();
    assert.equal(remoteTag, head);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("trusted private-repository tag publication bypasses source hooks and keeps raw auth out of Git", async () => {
  const { git, repoRoot } = await createReleaseRepo("0.7.96");
  const marker = join(repoRoot, "pre-push-read-token.log");
  const hook = join(repoRoot, ".git", "hooks", "pre-push");
  const token = "fixture-write-token-not-real";
  try {
    await configureTestOrigin({ git, repoRoot });
    await writeFile(
      hook,
      `#!/usr/bin/env bash\nprintf '%s\\n' "\${GIT_CONFIG_VALUE_4:-missing}" > ${JSON.stringify(marker)}\nexit 97\n`
    );
    await chmod(hook, 0o755);
    const sourceSha = (await git("rev-parse", "HEAD")).stdout.trim();
    const gitEnvironment = createTrustedGitEnvironment(
      {
        ...process.env,
        OPENMELD_TRUSTED_GIT_GITHUB_TOKEN: token,
      },
      {
        authenticate: true,
        repository: "amplifthq/openmeld",
        serverUrl: "https://github.com",
        token,
      }
    );
    const localGitEnvironment = createTrustedGitEnvironment(process.env);
    assert.equal(gitEnvironment.OPENMELD_TRUSTED_GIT_GITHUB_TOKEN, undefined);

    assert.deepEqual(
      publishCliReleaseTag({
        cwd: repoRoot,
        gitEnvironment,
        localGitEnvironment,
        remoteUrl: join(repoRoot, ".git", "test-origin.git"),
        sourceSha,
      }),
      { created: true, published: true, tagName: "v0.7.96" }
    );
    assert.equal(
      existsSync(marker),
      false,
      "historical pre-push hooks must never see the authenticated push"
    );
    assert.deepEqual(
      publishCliReleaseTag({
        cwd: repoRoot,
        gitEnvironment,
        localGitEnvironment,
        remoteUrl: join(repoRoot, ".git", "test-origin.git"),
        sourceSha,
      }),
      { created: false, published: true, tagName: "v0.7.96" }
    );
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("refuses to move an existing release tag to a different commit", async () => {
  const { git, repoRoot } = await createReleaseRepo("0.7.96");
  try {
    tagCliRelease({ cwd: repoRoot });
    await git("commit", "--allow-empty", "-m", "drift after publish");
    assert.throws(() => tagCliRelease({ cwd: repoRoot }), TAG_CONFLICT_RE);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("fails a conflicting release tag before starting network probes", async () => {
  const { git, repoRoot } = await createReleaseRepo("0.7.96");
  try {
    await mkdir(join(repoRoot, "release"), { recursive: true });
    await writeFile(join(repoRoot, "release/local-components.json"), "{}\n");
    await git("add", "release/local-components.json");
    await git("commit", "-m", "add release manifest");
    await git("tag", "-a", "v0.7.96", "-m", "release");
    await git("commit", "--allow-empty", "-m", "different release source");
    let networkProbeStarted = false;
    await assert.rejects(
      runCliRelease({
        adapters: {
          fetch: () => {
            networkProbeStarted = true;
            throw new Error("network probe must not start");
          },
          runCommand: () => {
            networkProbeStarted = true;
            throw new Error("network probe must not start");
          },
        },
        cwd: repoRoot,
        env: {},
        withBinary: true,
      }),
      IMMUTABLE_TAG_CONFLICT_RE
    );
    assert.equal(networkProbeStarted, false);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("routes the Core deploy step through deploy:core:local-components so it inherits the channel-sync gate", () => {
  assert.deepEqual(buildCoreDeployStepSpec(), {
    args: ["run", "deploy:core:local-components"],
    command: "pnpm",
    label: "Deploy Core with the published local-components manifest",
  });
});

test("passes the Core release tag through pnpm run so Wrangler receives it", () => {
  assert.deepEqual(
    buildCoreDeployStepSpec({ targetTag: "openmeld-release-target" }),
    {
      args: [
        "run",
        "deploy:core:local-components",
        "--tag",
        "openmeld-release-target",
      ],
      command: "pnpm",
      label: "Deploy Core with the published local-components manifest",
    }
  );
});

test("assertChannelReadyForVersionOnlyRelease skips the channel check entirely when --with-binary is used", async () => {
  const fetchStub = () => {
    throw new Error("fetch should not be called when --with-binary is set");
  };
  await assert.doesNotReject(
    assertChannelReadyForVersionOnlyRelease({
      fetch: fetchStub,
      withBinary: true,
    })
  );
});

test("assertChannelReadyForVersionOnlyRelease skips the channel check when the escape hatch env var is set", async () => {
  const fetchStub = () => {
    throw new Error("fetch should not be called when the escape hatch is set");
  };
  await assert.doesNotReject(
    assertChannelReadyForVersionOnlyRelease({
      env: { OPENMELD_SKIP_CHANNEL_SYNC_CHECK: "1" },
      fetch: fetchStub,
      withBinary: false,
    })
  );
});

test("assertChannelReadyForVersionOnlyRelease refuses to release ahead of the channel without --with-binary", async () => {
  const { repoRoot } = await createReleaseRepo("0.7.96");
  try {
    const fetchStub = () =>
      Promise.resolve({
        json: () => Promise.resolve(buildTestCliManifest("0.7.95")),
        ok: true,
        status: 200,
      });
    await assert.rejects(
      assertChannelReadyForVersionOnlyRelease({
        cwd: repoRoot,
        fetch: fetchStub,
        withBinary: false,
      }),
      (error) => {
        assert.match(error.message, CLI_RELEASE_REFUSED_RE);
        assert.match(error.message, DECLARED_CLI_VERSION_RE);
        assert.match(error.message, CHANNEL_CLI_VERSION_RE);
        assert.match(error.message, WITH_BINARY_FLAG_RE);
        return true;
      }
    );
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("assertChannelReadyForVersionOnlyRelease passes when the channel already has the declared version", async () => {
  const { repoRoot } = await createReleaseRepo("0.7.96");
  try {
    const manifest = buildTestCliManifest("0.7.96");
    const fetchStub = (_url, options) =>
      Promise.resolve(
        options?.method === "HEAD"
          ? { ok: true, status: 200 }
          : {
              json: () => Promise.resolve(manifest),
              ok: true,
              status: 200,
            }
      );
    await assert.doesNotReject(
      assertChannelReadyForVersionOnlyRelease({
        cwd: repoRoot,
        fetch: fetchStub,
        withBinary: false,
      })
    );
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("assertChannelReadyForVersionOnlyRelease fails closed when the production manifest fetch fails", async () => {
  const { repoRoot } = await createReleaseRepo("0.7.96");
  try {
    const fetchStub = () => Promise.reject(new Error("getaddrinfo ENOTFOUND"));
    await assert.rejects(
      assertChannelReadyForVersionOnlyRelease({
        cwd: repoRoot,
        fetch: fetchStub,
        withBinary: false,
      }),
      ENOTFOUND_RE
    );
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("preserves a failed stage error and prints the canonical resume command", async () => {
  const { git, repoRoot } = await createReleaseRepo("0.7.96");
  try {
    await mkdir(join(repoRoot, "release"), { recursive: true });
    await writeFile(join(repoRoot, "release/local-components.json"), "{}\n");
    await git("add", "release/local-components.json");
    await git("commit", "-m", "add release manifest");
    const coreTag = resolveCoreProjectionTag({ cwd: repoRoot });
    await assert.rejects(
      runCliRelease({
        adapters: {
          fetch: (_url, options) => {
            if (options?.method === "HEAD") {
              return new Response(null, {
                headers: { "content-length": "100" },
                status: 200,
              });
            }
            return new Response(
              JSON.stringify({
                schemaVersion: 1,
                channels: {
                  stable: {
                    version: "0.7.95",
                    minRequiredCliVersion: "0.7.95",
                    platforms: {
                      "darwin-arm64": {
                        url: "https://openmeld.test/cli-0.7.96",
                        sha256: "b".repeat(64),
                        sizeBytes: 100,
                      },
                    },
                  },
                },
              }),
              { status: 200 }
            );
          },
          runCommand: ({ args, command }) => {
            const key = [command, ...args].join(" ");
            if (key.startsWith("npm view")) {
              return { status: 1, stderr: "npm error code E404", stdout: "" };
            }
            if (key.includes("wrangler deployments list")) {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify(WRANGLER_RELEASE_STATE.deployments),
              };
            }
            if (key.includes("wrangler versions list")) {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify(
                  WRANGLER_RELEASE_STATE.versions.map((version) => ({
                    ...version,
                    annotations: { "workers/tag": `${coreTag}-other` },
                  }))
                ),
              };
            }
            throw new Error(`Unexpected read-only command: ${key}`);
          },
          runStep: () => {
            throw new Error("manifest gate exploded");
          },
        },
        cwd: repoRoot,
        env: {},
        withBinary: true,
      }),
      (error) => {
        assert.match(error.message, MANIFEST_GATE_EXPLODED_RE);
        assert.match(error.message, RELEASE_RESUME_COMMAND_RE);
        return true;
      }
    );
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("stops before binary, npm, tag, and Core when the Queue gate fails", async () => {
  const { git, repoRoot } = await createReleaseRepo("0.7.96");
  try {
    await mkdir(join(repoRoot, "release"), { recursive: true });
    await writeFile(join(repoRoot, "release/local-components.json"), "{}\n");
    await git("add", "release/local-components.json");
    await git("commit", "-m", "add release manifest");
    const coreTag = resolveCoreProjectionTag({ cwd: repoRoot });
    const sideEffects = [];

    await assert.rejects(
      runCliRelease({
        adapters: {
          fetch: (_url, options) => {
            if (options?.method === "HEAD") {
              return new Response(null, {
                headers: { "content-length": "100" },
                status: 200,
              });
            }
            return new Response(
              JSON.stringify({
                schemaVersion: 1,
                channels: {
                  stable: {
                    version: "0.7.95",
                    minRequiredCliVersion: "0.7.95",
                    platforms: {
                      "darwin-arm64": {
                        url: "https://openmeld.test/cli-0.7.96",
                        sha256: "b".repeat(64),
                        sizeBytes: 100,
                      },
                    },
                  },
                },
              }),
              { status: 200 }
            );
          },
          runCommand: ({ args, command }) => {
            const key = [command, ...args].join(" ");
            if (key.startsWith("npm view")) {
              return { status: 1, stderr: "npm error code E404", stdout: "" };
            }
            if (key.includes("wrangler deployments list")) {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify(WRANGLER_RELEASE_STATE.deployments),
              };
            }
            if (key.includes("wrangler versions list")) {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify(
                  WRANGLER_RELEASE_STATE.versions.map((version) => ({
                    ...version,
                    annotations: { "workers/tag": `${coreTag}-other` },
                  }))
                ),
              };
            }
            throw new Error(`Unexpected read-only command: ${key}`);
          },
          runStep: (step) => {
            sideEffects.push(step.label);
            if (step.label === "Verify production Core Queue resources") {
              throw new Error("queue gate exploded");
            }
          },
          publishCliReleaseTag: () => sideEffects.push("tag"),
        },
        cwd: repoRoot,
        env: {},
        withBinary: true,
      }),
      (error) => {
        assert.match(error.message, QUEUE_GATE_EXPLODED_RE);
        assert.match(error.message, RELEASE_RESUME_COMMAND_RE);
        return true;
      }
    );

    assert.deepEqual(sideEffects, [
      "Verify local-components release manifest",
      "Verify production Core Queue resources",
    ]);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("a fully completed CLI release rerun skips every stage without side effects", async () => {
  const { git, repoRoot } = await createReleaseRepo("0.7.96");
  const releaseManifest = {
    schemaVersion: 1,
    components: {
      cli: { packageVersion: "0.7.96" },
      service: { bundleVersion: "0.7.96" },
      skills: { packageVersion: "0.7.96" },
    },
  };
  await mkdir(join(repoRoot, "release"), { recursive: true });
  await writeFile(
    join(repoRoot, "release/local-components.json"),
    `${JSON.stringify(releaseManifest, null, 2)}\n`
  );
  await git("add", "release/local-components.json");
  await git("commit", "-m", "add release manifest");
  const head = (await git("rev-parse", "HEAD")).stdout.trim();
  await configureTestOrigin({ git, repoRoot });
  await git("tag", "-a", "v0.7.96", "-m", "release");
  await git("push", "origin", "refs/tags/v0.7.96");
  const coreTag = resolveCoreProjectionTag({ cwd: repoRoot });
  const sideEffects = [];
  const output = [];
  try {
    const result = await runCliRelease({
      adapters: {
        fetch: (url, options) => {
          const manifest = buildTestCliManifest("0.7.96");
          if (options?.method === "HEAD") {
            assert.ok(options.signal instanceof AbortSignal);
            return new Response(null, {
              headers: {
                "content-length": String(TEST_CLI_BINARY.byteLength),
              },
              status: 200,
            });
          }
          if (String(url).endsWith(".gz")) {
            assert.equal(options?.method, "GET");
            return new Response(TEST_CLI_ARCHIVE, { status: 200 });
          }
          return new Response(JSON.stringify(manifest), { status: 200 });
        },
        runCommand: ({ args, command }) => {
          const key = [command, ...args].join(" ");
          if (
            key ===
            "npm view openmeld@0.7.96 version openmeld.minRequiredCliVersion --json"
          ) {
            return {
              status: 0,
              stderr: "",
              stdout: buildCapturedNpmVersionFloorStdout({
                minRequiredCliVersion: "0.7.96",
                version: "0.7.96",
              }),
            };
          }
          if (key.includes("wrangler deployments list")) {
            return {
              status: 0,
              stderr: "",
              stdout: JSON.stringify(WRANGLER_RELEASE_STATE.deployments),
            };
          }
          if (key.includes("wrangler versions list")) {
            return {
              status: 0,
              stderr: "",
              stdout: JSON.stringify(
                WRANGLER_RELEASE_STATE.versions.map((version) => ({
                  ...version,
                  annotations: { "workers/tag": coreTag },
                }))
              ),
            };
          }
          throw new Error(`Unexpected read-only command: ${key}`);
        },
        runStep: (step) => sideEffects.push(step.label),
        publishCliReleaseTag: () => sideEffects.push("tag"),
      },
      cwd: repoRoot,
      env: {},
      withBinary: true,
      write: (value) => output.push(value),
    });

    assert.equal(result.alignment.action, "SKIP");
    assert.deepEqual(sideEffects, []);
    const rendered = output.join("");
    for (const label of [
      "Verify local-components release manifest",
      "CLI binary channel",
      "npm publish",
      "Release tag",
      "Core release projection",
      "Final R2/npm/Core alignment",
    ]) {
      assert.match(
        rendered,
        new RegExp(
          `${label.replaceAll("/", "\\/")} — SKIP \\(already done`,
          "u"
        )
      );
    }
    assert.equal(rendered.match(new RegExp(ALREADY_DONE_RE, "gu"))?.length, 6);
    assert.match(rendered, THREE_WAY_ALIGNMENT_RE);
    assert.equal((await git("rev-parse", "HEAD")).stdout.trim(), head);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("stops before every release mutation when immutable npm metadata is wrong", async () => {
  const { git, repoRoot } = await createReleaseRepo("0.7.96");
  await mkdir(join(repoRoot, "release"), { recursive: true });
  await writeFile(join(repoRoot, "release/local-components.json"), "{}\n");
  await git("add", "release/local-components.json");
  await git("commit", "-m", "add release manifest");
  await configureTestOrigin({ git, repoRoot });
  const coreTag = resolveCoreProjectionTag({ cwd: repoRoot });
  const sideEffects = [];

  try {
    await assert.rejects(
      runCliRelease({
        adapters: {
          fetch: (url, options) => {
            const manifest = buildTestCliManifest("0.7.96");
            if (options?.method === "HEAD") {
              return new Response(null, {
                headers: {
                  "content-length": String(TEST_CLI_BINARY.byteLength),
                },
                status: 200,
              });
            }
            if (String(url).endsWith(".gz")) {
              return new Response(TEST_CLI_ARCHIVE, { status: 200 });
            }
            return new Response(JSON.stringify(manifest), { status: 200 });
          },
          runCommand: ({ args, command }) => {
            const key = [command, ...args].join(" ");
            if (key.startsWith("npm view")) {
              return {
                status: 0,
                stderr: "",
                stdout: buildCapturedNpmVersionFloorStdout({
                  minRequiredCliVersion: "0.7.95",
                  version: "0.7.96",
                }),
              };
            }
            if (key.includes("wrangler deployments list")) {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify(WRANGLER_RELEASE_STATE.deployments),
              };
            }
            if (key.includes("wrangler versions list")) {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify(
                  WRANGLER_RELEASE_STATE.versions.map((version) => ({
                    ...version,
                    annotations: { "workers/tag": coreTag },
                  }))
                ),
              };
            }
            throw new Error(`Unexpected read-only command: ${key}`);
          },
          runStep: (step) => sideEffects.push(step.label),
          publishCliReleaseTag: () => sideEffects.push("tag"),
        },
        cwd: repoRoot,
        env: {},
        withBinary: true,
      }),
      IMMUTABLE_NPM_METADATA_RE
    );
    assert.deepEqual(sideEffects, []);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("stops before every release mutation when immutable R2 metadata is wrong", async () => {
  const { git, repoRoot } = await createReleaseRepo("0.7.96");
  await mkdir(join(repoRoot, "release"), { recursive: true });
  await writeFile(join(repoRoot, "release/local-components.json"), "{}\n");
  await git("add", "release/local-components.json");
  await git("commit", "-m", "add release manifest");
  await configureTestOrigin({ git, repoRoot });
  const coreTag = resolveCoreProjectionTag({ cwd: repoRoot });
  const sideEffects = [];

  try {
    await assert.rejects(
      runCliRelease({
        adapters: {
          fetch: (url, options) => {
            const manifest = buildTestCliManifest("0.7.96");
            manifest.channels.stable.minRequiredCliVersion = "0.7.95";
            if (options?.method === "HEAD") {
              return new Response(null, {
                headers: {
                  "content-length": String(TEST_CLI_BINARY.byteLength),
                },
                status: 200,
              });
            }
            if (String(url).endsWith(".gz")) {
              return new Response(TEST_CLI_ARCHIVE, { status: 200 });
            }
            return new Response(JSON.stringify(manifest), { status: 200 });
          },
          runCommand: ({ args, command }) => {
            const key = [command, ...args].join(" ");
            if (key.startsWith("npm view")) {
              return {
                status: 0,
                stderr: "",
                stdout: buildCapturedNpmVersionFloorStdout({
                  minRequiredCliVersion: "0.7.96",
                  version: "0.7.96",
                }),
              };
            }
            if (key.includes("wrangler deployments list")) {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify(WRANGLER_RELEASE_STATE.deployments),
              };
            }
            if (key.includes("wrangler versions list")) {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify(
                  WRANGLER_RELEASE_STATE.versions.map((version) => ({
                    ...version,
                    annotations: { "workers/tag": coreTag },
                  }))
                ),
              };
            }
            throw new Error(`Unexpected read-only command: ${key}`);
          },
          runStep: (step) => sideEffects.push(step.label),
          publishCliReleaseTag: () => sideEffects.push("tag"),
        },
        cwd: repoRoot,
        env: {},
        withBinary: true,
      }),
      IMMUTABLE_R2_METADATA_RE
    );
    assert.deepEqual(sideEffects, []);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("stops before every release mutation when immutable binary completion is unsafe", async () => {
  const capturedNpmResponse = NPM_VERSION_FLOOR_FIXTURE.response;
  const releaseCases = [
    {
      name: "the target manifest points to a missing raw artifact",
      expected: IMMUTABLE_R2_ARTIFACT_RE,
      fetch: (url, options) => {
        const manifest = buildTestCliManifest(capturedNpmResponse.version, {
          minRequiredCliVersion:
            capturedNpmResponse["openmeld.minRequiredCliVersion"],
        });
        if (options?.method === "HEAD") {
          return new Response(null, { status: 404 });
        }
        if (String(url).endsWith(".gz")) {
          return new Response(TEST_CLI_ARCHIVE, { status: 200 });
        }
        return new Response(JSON.stringify(manifest), { status: 200 });
      },
    },
    {
      name: "the completion probe cannot prove whether the target exists",
      expected: INCONCLUSIVE_R2_PROBE_RE,
      fetch: () => Promise.reject(new Error("read-only probe unavailable")),
    },
  ];

  for (const releaseCase of releaseCases) {
    const { git, repoRoot } = await createReleaseRepo(
      capturedNpmResponse.version,
      {
        minRequiredCliVersion:
          capturedNpmResponse["openmeld.minRequiredCliVersion"],
      }
    );
    await mkdir(join(repoRoot, "release"), { recursive: true });
    await writeFile(join(repoRoot, "release/local-components.json"), "{}\n");
    await git("add", "release/local-components.json");
    await git("commit", "-m", "add release manifest");
    await configureTestOrigin({ git, repoRoot });
    const coreTag = resolveCoreProjectionTag({ cwd: repoRoot });
    const sideEffects = [];

    try {
      await assert.rejects(
        runCliRelease({
          adapters: {
            fetch: releaseCase.fetch,
            runCommand: ({ args, command }) => {
              const key = [command, ...args].join(" ");
              if (key.startsWith("npm view")) {
                return {
                  status: 0,
                  stderr: "",
                  stdout: `${JSON.stringify(capturedNpmResponse)}\n`,
                };
              }
              if (key.includes("wrangler deployments list")) {
                return {
                  status: 0,
                  stderr: "",
                  stdout: JSON.stringify(WRANGLER_RELEASE_STATE.deployments),
                };
              }
              if (key.includes("wrangler versions list")) {
                return {
                  status: 0,
                  stderr: "",
                  stdout: JSON.stringify(
                    WRANGLER_RELEASE_STATE.versions.map((version) => ({
                      ...version,
                      annotations: { "workers/tag": coreTag },
                    }))
                  ),
                };
              }
              throw new Error(`Unexpected read-only command: ${key}`);
            },
            runStep: (step) => sideEffects.push(step.label),
            publishCliReleaseTag: () => sideEffects.push("tag"),
          },
          cwd: repoRoot,
          env: {},
          withBinary: true,
        }),
        releaseCase.expected,
        releaseCase.name
      );
      assert.deepEqual(sideEffects, [], releaseCase.name);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  }
});

test("stops before every release mutation when the stable CLI channel is ahead", async () => {
  const targetVersion = "0.3.131";
  const { git, repoRoot } = await createReleaseRepo(targetVersion);
  await mkdir(join(repoRoot, "release"), { recursive: true });
  await writeFile(join(repoRoot, "release/local-components.json"), "{}\n");
  await git("add", "release/local-components.json");
  await git("commit", "-m", "add release manifest");
  await configureTestOrigin({ git, repoRoot });
  const coreTag = resolveCoreProjectionTag({ cwd: repoRoot });
  const sideEffects = [];

  try {
    await assert.rejects(
      runCliRelease({
        adapters: {
          fetch: (url, options) => {
            const manifest = buildTestCliManifest("0.3.132");
            if (options?.method === "HEAD") {
              return new Response(null, {
                headers: {
                  "content-length": String(TEST_CLI_BINARY.byteLength),
                },
                status: 200,
              });
            }
            if (String(url).endsWith(".gz")) {
              return new Response(TEST_CLI_ARCHIVE, { status: 200 });
            }
            return new Response(JSON.stringify(manifest), { status: 200 });
          },
          runCommand: ({ args, command }) => {
            const key = [command, ...args].join(" ");
            if (key.startsWith("npm view")) {
              return { status: 1, stderr: "npm error code E404", stdout: "" };
            }
            if (key.includes("wrangler deployments list")) {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify(WRANGLER_RELEASE_STATE.deployments),
              };
            }
            if (key.includes("wrangler versions list")) {
              return {
                status: 0,
                stderr: "",
                stdout: JSON.stringify(
                  WRANGLER_RELEASE_STATE.versions.map((version) => ({
                    ...version,
                    annotations: { "workers/tag": `${coreTag}-other` },
                  }))
                ),
              };
            }
            throw new Error(`Unexpected read-only command: ${key}`);
          },
          runStep: (step) => {
            sideEffects.push(step.label);
            throw new Error("release mutation must not start");
          },
          publishCliReleaseTag: () => sideEffects.push("tag"),
        },
        cwd: repoRoot,
        env: {},
        withBinary: true,
      }),
      R2_STABLE_CHANNEL_AHEAD_RE
    );
    assert.deepEqual(sideEffects, []);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("resumes a newer CLI target without probing artifacts from an older manifest", async () => {
  const artifactRequests = [];
  const target = {
    coreTag: "openmeld-release-target",
    minRequiredCliVersion: "0.3.131",
    version: "0.3.131",
  };

  const result = await probeCliReleaseStages({
    adapters: {
      fetch: (url, options) => {
        if (options?.method) {
          artifactRequests.push({ method: options.method, url: String(url) });
          return Promise.reject(
            new Error("old immutable artifact must not be requested")
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(buildTestCliManifest("0.3.130")), {
            status: 200,
          })
        );
      },
      runCommand: ({ args, command }) => {
        const key = [command, ...args].join(" ");
        if (key.startsWith("npm view")) {
          return { status: 1, stderr: "npm error code E404", stdout: "" };
        }
        if (key.includes("wrangler deployments list")) {
          return {
            status: 0,
            stderr: "",
            stdout: JSON.stringify(WRANGLER_RELEASE_STATE.deployments),
          };
        }
        if (key.includes("wrangler versions list")) {
          return {
            status: 0,
            stderr: "",
            stdout: JSON.stringify(
              WRANGLER_RELEASE_STATE.versions.map((version) => ({
                ...version,
                annotations: { "workers/tag": "another-release" },
              }))
            ),
          };
        }
        throw new Error(`Unexpected read-only command: ${key}`);
      },
    },
    cwd: process.cwd(),
    env: {},
    tag: { action: "RUN", reason: "the release tag is not published" },
    target,
  });

  assert.deepEqual(result.binary, {
    action: "RUN",
    reason: "the production CLI manifest is at 0.3.130, below target 0.3.131",
  });
  assert.deepEqual(artifactRequests, []);
});
