import { sign, verify } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OFFICIAL_CLI_SKILL_CONTRACT,
  OFFICIAL_CLI_SKILL_MAX_BYTES,
  OFFICIAL_CLI_SKILL_PUBLIC_KEY,
  officialCliSkillChannelSchema,
  officialCliSkillPayloadSchema,
} from "../../packages/schemas/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(root, "release/openmeld-cli-skill");
const destination = join(root, "clients/web/public/skills/openmeld-cli");
const channelPath = join(destination, "channel.json");
const mode = process.argv[2];
if (mode !== "build" && mode !== "check") {
  throw new Error("Usage: node scripts/release/cli-skill.mjs build|check");
}
const metadata = JSON.parse(
  await readFile(join(source, "release.json"), "utf8")
);
const files = [];
for (const path of [
  "SKILL.md",
  ...(await markdownPaths("playbooks")),
  ...(await markdownPaths("references")),
]) {
  files.push({ path, content: await readFile(join(source, path), "utf8") });
}
files.sort((a, b) => a.path.localeCompare(b.path));
const payload = JSON.stringify(
  officialCliSkillPayloadSchema.parse({
    schemaVersion: 1,
    revision: metadata.revision,
    minimumCliVersion: metadata.minimumCliVersion,
    contractVersion: OFFICIAL_CLI_SKILL_CONTRACT,
    files,
  })
);
let channel = await readFile(channelPath, "utf8").then(
  (raw) => officialCliSkillChannelSchema.parse(JSON.parse(raw)),
  (error) => {
    if (error.code === "ENOENT" && mode === "build") {
      return { schemaVersion: 1, releases: [] };
    }
    throw error;
  }
);
for (const release of channel.releases) {
  if (
    !verify(
      null,
      Buffer.from(release.payload),
      OFFICIAL_CLI_SKILL_PUBLIC_KEY,
      Buffer.from(release.signature, "base64")
    )
  ) {
    throw new Error("Published Skill signature is invalid");
  }
  officialCliSkillPayloadSchema.parse(JSON.parse(release.payload));
}
const existing = channel.releases.find(
  (release) => JSON.parse(release.payload).revision === metadata.revision
);
if (existing && existing.payload !== payload) {
  throw new Error(
    "Published revisions are immutable; increment release.json revision"
  );
}
if (!existing) {
  if (mode === "check") {
    throw new Error(
      "Skill source has no signed release; run cli-skill.mjs build"
    );
  }
  const latest = Math.max(
    0,
    ...channel.releases.map((release) => JSON.parse(release.payload).revision)
  );
  if (metadata.revision <= latest) {
    throw new Error("Skill revisions must increase");
  }
  const keyPath =
    process.env.OPENMELD_CLI_SKILL_SIGNING_KEY_FILE ??
    join(homedir(), ".config/openmeld-release/cli-skill-signing.pem");
  const signature = sign(
    null,
    Buffer.from(payload),
    await readFile(keyPath)
  ).toString("base64");
  if (
    !verify(
      null,
      Buffer.from(payload),
      OFFICIAL_CLI_SKILL_PUBLIC_KEY,
      Buffer.from(signature, "base64")
    )
  ) {
    throw new Error("Signing key does not match the pinned public key");
  }
  channel = officialCliSkillChannelSchema.parse({
    schemaVersion: 1,
    // Keep the newest content for each supported CLI/contract compatibility
    // floor. Routine wording updates must not grow every user's download.
    releases: [
      ...channel.releases.filter((release) => {
        const previous = JSON.parse(release.payload);
        return (
          previous.minimumCliVersion !== metadata.minimumCliVersion ||
          previous.contractVersion !== OFFICIAL_CLI_SKILL_CONTRACT
        );
      }),
      { payload, signature },
    ],
  });
}
const channelText = `${JSON.stringify(channel, null, 2)}\n`;
if (Buffer.byteLength(channelText) > OFFICIAL_CLI_SKILL_MAX_BYTES) {
  throw new Error("Skill channel exceeds size limit");
}
await materialize(channelPath, channelText);
for (const release of channel.releases) {
  const parsed = officialCliSkillPayloadSchema.parse(
    JSON.parse(release.payload)
  );
  for (const file of parsed.files) {
    await materialize(
      join(destination, "releases", String(parsed.revision), file.path),
      file.content
    );
  }
}
for (const file of files) {
  await materialize(join(destination, file.path), file.content);
}
process.stdout.write(
  `Official CLI Skill revision ${metadata.revision}: ${mode} passed\n`
);

async function markdownPaths(dir) {
  return (await readdir(join(source, dir)))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => `${dir}/${name}`);
}
async function materialize(path, content) {
  if (mode === "check") {
    if ((await readFile(path, "utf8")) !== content) {
      throw new Error(`Generated Skill file differs: ${path}`);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
