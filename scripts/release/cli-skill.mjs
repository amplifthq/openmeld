import { execFileSync, spawnSync } from "node:child_process";
import { sign, verify } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  OFFICIAL_CLI_SKILL_CONTRACT,
  OFFICIAL_CLI_SKILL_MAX_BYTES,
  OFFICIAL_CLI_SKILL_PUBLIC_KEY,
  officialCliSkillChannelSchema,
  officialCliSkillPayloadSchema,
  officialCliSkillReleaseSchema,
} from "../../packages/schemas/src/official-cli-skill.ts";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function runCliSkill(input = {}) {
  const mode = input.mode ?? process.argv[2];
  if (mode !== "build" && mode !== "check") {
    throw new Error("Usage: node scripts/release/cli-skill.mjs build|check");
  }
  const controlRoot = await realpath(defaultRoot);
  const root = await realpath(
    mode === "check"
      ? (input.root ?? process.env.OPENMELD_VERIFICATION_ROOT ?? controlRoot)
      : controlRoot
  );
  const external = root !== controlRoot;
  const source = join(root, "release/openmeld-cli-skill");
  const destination = join(root, "clients/web/public/skills/openmeld-cli");
  const channelPath = join(destination, "channel.json");
  const archivePath = join(destination, "archive.json");
  if (
    await isHistoricalSourceWithoutSkill({
      mode,
      external,
      source,
      destination,
      root,
      controlRoot,
      env: input.env ?? process.env,
    })
  ) {
    return;
  }
  let channel = await readChannel(channelPath, mode);
  const metadataSource = JSON.parse(
    await readFile(join(source, "release.json"), "utf8")
  );
  const existing = channel.releases.find(
    (release) => verifyRelease(release).revision === metadataSource.revision
  );
  const contract =
    external && mode === "check" && existing
      ? verifyRelease(existing).contractVersion
      : OFFICIAL_CLI_SKILL_CONTRACT;
  const { files, metadata, payload } = await readSkillSource(source, contract);
  const historicalArchiveMissing = external && !(await pathExists(archivePath));
  let archive = await readArchive(
    archivePath,
    channel,
    historicalArchiveMissing ? "build" : mode
  );
  const trustedReleases =
    input.trustedReleases ??
    (await trustedHistoryForSource({
      root,
      controlRoot,
      external,
      channel,
      env: input.env ?? process.env,
    }));
  assertTrustedHistoryPreserved(archive.releases, trustedReleases);
  const trustedRevisions = new Set(
    trustedReleases.map((release) => verifyRelease(release).revision)
  );
  const releaseState = await resolveReleaseState({
    archive,
    channel,
    env: input.env ?? process.env,
    metadata,
    mode,
    payload,
  });
  archive = releaseState.archive;
  channel = releaseState.channel;

  archive.releases.sort(
    (a, b) => JSON.parse(a.payload).revision - JSON.parse(b.payload).revision
  );
  const channelText = `${JSON.stringify(channel, null, 2)}\n`;
  if (Buffer.byteLength(channelText) > OFFICIAL_CLI_SKILL_MAX_BYTES) {
    throw new Error("Skill channel exceeds size limit");
  }
  await materialize(channelPath, channelText, mode);
  if (!historicalArchiveMissing) {
    await materialize(
      archivePath,
      `${JSON.stringify(archive, null, 2)}\n`,
      mode
    );
  }
  for (const release of archive.releases) {
    const parsed = verifyRelease(release);
    const releaseRoot = join(destination, "releases", String(parsed.revision));
    for (const file of parsed.files) {
      await materializePublishedRevision(
        join(releaseRoot, file.path),
        file.content,
        {
          allowCreate: !trustedRevisions.has(parsed.revision),
          mode,
          revision: parsed.revision,
        }
      );
    }
    await assertPublishedFileInventory(releaseRoot, parsed.files);
  }
  await assertPublishedRevisionInventory(
    join(destination, "releases"),
    archive.releases.map((release) => verifyRelease(release).revision)
  );
  for (const file of files) {
    await materialize(join(destination, file.path), file.content, mode);
  }
  process.stdout.write(
    `Official CLI Skill revision ${metadata.revision}: ${mode} passed\n`
  );
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function isHistoricalSourceWithoutSkill(input) {
  if (
    input.mode !== "check" ||
    !input.external ||
    (await pathExists(input.source)) ||
    (await pathExists(input.destination))
  ) {
    return false;
  }
  const prior = await trustedHistoryForSource({
    ...input,
    channel: { releases: [] },
  });
  if (prior.length) {
    throw new Error(
      "Published Skill delivery cannot be removed from the trusted history."
    );
  }
  process.stdout.write(
    "Official CLI Skill: not applicable to this historical source (no Skill source or public artifacts).\n"
  );
  return true;
}

async function trustedHistoryForSource({
  root,
  controlRoot,
  external,
  channel,
  env,
}) {
  if (external && !(await pathExists(join(root, ".git")))) {
    return channel.releases;
  }
  let historyEnv = env;
  if (external && !env.OPENMELD_AFFECTED_BASE) {
    const controlSha = resolveGitCommit(controlRoot, "HEAD");
    const sourceSha = resolveGitCommit(root, "HEAD");
    const ancestry = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", sourceSha, controlSha],
      { cwd: root, stdio: "pipe" }
    );
    // Approved historical checkouts retain their own signed history. A new
    // candidate must still preserve the current trusted base's revisions.
    if (ancestry.status === 0) {
      historyEnv = { ...env, OPENMELD_AFFECTED_BASE: sourceSha };
    }
  }
  return readTrustedReleases({ root, env: historyEnv });
}

async function readSkillSource(source, contractVersion) {
  const metadata = JSON.parse(
    await readFile(join(source, "release.json"), "utf8")
  );
  const paths = [
    "SKILL.md",
    ...(await markdownPaths(source, "playbooks")),
    ...(await markdownPaths(source, "references")),
  ];
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(join(source, path), "utf8"),
    }))
  );
  files.sort((a, b) => a.path.localeCompare(b.path));
  const payload = JSON.stringify(
    officialCliSkillPayloadSchema.parse({
      schemaVersion: 1,
      revision: metadata.revision,
      minimumCliVersion: metadata.minimumCliVersion,
      contractVersion,
      files,
    })
  );
  return { files, metadata, payload };
}

async function resolveReleaseState(input) {
  const archivedByRevision = indexArchivedReleases(
    input.archive.releases,
    input.channel.releases
  );
  const existing = archivedByRevision.get(input.metadata.revision)?.release;
  if (existing) {
    if (existing.payload !== input.payload) {
      throw new Error(
        "Published revisions are immutable; increment release.json revision"
      );
    }
    if (input.metadata.revision !== Math.max(...archivedByRevision.keys())) {
      throw new Error(
        "Skill source revision must be the latest signed revision"
      );
    }
    return {
      archive: input.archive,
      channel: input.channel,
    };
  }
  if (input.mode === "check") {
    throw new Error(
      "Skill source has no signed release; run cli-skill.mjs build"
    );
  }
  if (input.metadata.revision <= Math.max(0, ...archivedByRevision.keys())) {
    throw new Error("Skill revisions must increase");
  }
  const keyPath =
    input.env.OPENMELD_CLI_SKILL_SIGNING_KEY_FILE ??
    join(homedir(), ".config/openmeld-release/cli-skill-signing.pem");
  const signature = sign(
    null,
    Buffer.from(input.payload),
    await readFile(keyPath)
  ).toString("base64");
  const release = officialCliSkillReleaseSchema.parse({
    payload: input.payload,
    signature,
  });
  verifyRelease(release, "Signing key does not match the pinned public key");
  return {
    archive: {
      schemaVersion: 1,
      releases: [...input.archive.releases, release],
    },
    channel: officialCliSkillChannelSchema.parse({
      schemaVersion: 1,
      releases: [
        ...input.channel.releases.filter((candidate) => {
          const previous = JSON.parse(candidate.payload);
          return (
            previous.minimumCliVersion !== input.metadata.minimumCliVersion ||
            previous.contractVersion !== OFFICIAL_CLI_SKILL_CONTRACT
          );
        }),
        release,
      ],
    }),
  };
}

function indexArchivedReleases(archive, channel) {
  const indexed = new Map();
  for (const release of archive) {
    const parsed = verifyRelease(release);
    if (indexed.has(parsed.revision)) {
      throw new Error(
        `Published Skill revision ${parsed.revision} is duplicated`
      );
    }
    indexed.set(parsed.revision, { parsed, release });
  }
  for (const release of channel) {
    const parsed = verifyRelease(release);
    const archived = indexed.get(parsed.revision)?.release;
    if (
      !(
        archived &&
        archived.payload === release.payload &&
        archived.signature === release.signature
      )
    ) {
      throw new Error(
        `Skill channel revision ${parsed.revision} does not match the signed archive`
      );
    }
  }
  return indexed;
}

async function readChannel(path, mode) {
  return await readFile(path, "utf8").then(
    (raw) => officialCliSkillChannelSchema.parse(JSON.parse(raw)),
    (error) => {
      if (error.code === "ENOENT" && mode === "build") {
        return { schemaVersion: 1, releases: [] };
      }
      throw error;
    }
  );
}

async function readArchive(path, channel, mode) {
  return await readFile(path, "utf8").then(
    (raw) => parseArchive(JSON.parse(raw)),
    (error) => {
      if (error.code === "ENOENT" && mode === "build") {
        return { schemaVersion: 1, releases: [...channel.releases] };
      }
      throw error;
    }
  );
}

function parseArchive(value) {
  if (
    !(
      value &&
      typeof value === "object" &&
      value.schemaVersion === 1 &&
      Array.isArray(value.releases)
    )
  ) {
    throw new Error("Published Skill archive is invalid");
  }
  return {
    schemaVersion: 1,
    releases: value.releases.map((release) =>
      officialCliSkillReleaseSchema.parse(release)
    ),
  };
}

function verifyRelease(
  release,
  signatureError = "Published Skill signature is invalid"
) {
  const envelope = officialCliSkillReleaseSchema.parse(release);
  if (
    !verify(
      null,
      Buffer.from(envelope.payload),
      OFFICIAL_CLI_SKILL_PUBLIC_KEY,
      Buffer.from(envelope.signature, "base64")
    )
  ) {
    throw new Error(signatureError);
  }
  return officialCliSkillPayloadSchema.parse(JSON.parse(envelope.payload));
}

function readTrustedReleases({ env, root }) {
  const ref = env.OPENMELD_AFFECTED_BASE?.trim() || "origin/main";
  const commit = resolveGitCommit(root, ref);
  const archivePath = "clients/web/public/skills/openmeld-cli/archive.json";
  if (gitPathExists(root, commit, archivePath)) {
    return parseArchive(readGitJson(root, commit, archivePath)).releases;
  }
  if (
    !(
      gitPathExists(root, commit, "clients/web/public/skills/openmeld-cli") ||
      gitPathExists(root, commit, "release/openmeld-cli-skill")
    )
  ) {
    return [];
  }
  const channel = readGitJson(
    root,
    commit,
    "clients/web/public/skills/openmeld-cli/channel.json"
  );
  return officialCliSkillChannelSchema.parse(channel).releases;
}

function resolveGitCommit(root, ref) {
  try {
    return execFileSync(
      process.platform === "win32" ? "git.exe" : "git",
      ["rev-parse", "--verify", `${ref}^{commit}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  } catch (error) {
    const detail = String(error?.stderr ?? "").trim();
    throw new Error(
      `Cannot resolve trusted CLI Skill base ${ref}.${detail ? ` ${detail}` : ""}`
    );
  }
}

function gitPathExists(root, commit, path) {
  const result = spawnSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["ls-tree", "--name-only", "-z", commit, "--", path],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Cannot inspect trusted CLI Skill history at ${commit}:${path}: ${String(result.stderr).trim()}`
    );
  }
  return String(result.stdout).split("\0").filter(Boolean).includes(path);
}

function readGitJson(root, ref, path) {
  let raw;
  try {
    raw = execFileSync(
      process.platform === "win32" ? "git.exe" : "git",
      ["show", `${ref}:${path}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (error) {
    const detail = String(error?.stderr ?? "").trim();
    throw new Error(
      `Cannot read trusted CLI Skill history from ${ref}:${path}.${detail ? ` ${detail}` : ""}`
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Trusted CLI Skill history at ${ref}:${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function assertTrustedHistoryPreserved(releases, trustedReleases) {
  const current = new Map(
    releases.map((release) => [verifyRelease(release).revision, release])
  );
  for (const trusted of trustedReleases) {
    const revision = verifyRelease(trusted).revision;
    const candidate = current.get(revision);
    if (
      !(
        candidate &&
        candidate.payload === trusted.payload &&
        candidate.signature === trusted.signature
      )
    ) {
      throw new Error(
        `Published Skill revision ${revision} cannot be changed or removed from the trusted history`
      );
    }
  }
}

async function markdownPaths(source, dir) {
  return (await readdir(join(source, dir)))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => `${dir}/${name}`);
}

async function materialize(path, content, mode) {
  if (mode === "check") {
    if ((await readFile(path, "utf8")) !== content) {
      throw new Error(`Generated Skill file differs: ${path}`);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function materializePublishedRevision(path, content, input) {
  const current = await readFile(path, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (current === content) {
    return;
  }
  if (current !== null || input.mode === "check" || !input.allowCreate) {
    throw new Error(
      `Published Skill revision ${input.revision} is immutable: ${path}`
    );
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function assertPublishedFileInventory(releaseRoot, files) {
  const expected = files.map((file) => file.path).sort();
  const actual = (await listFiles(releaseRoot)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Published Skill revision file inventory differs: ${releaseRoot}`
    );
  }
}

async function assertPublishedRevisionInventory(releasesRoot, revisions) {
  const actual = (await readdir(releasesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => Number(a) - Number(b));
  const expected = revisions.map(String).sort((a, b) => Number(a) - Number(b));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Published Skill revision inventory differs from archive");
  }
}

async function listFiles(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runCliSkill();
}
