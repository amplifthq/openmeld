import { randomUUID, verify } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OFFICIAL_CLI_SKILL_CONTRACT,
  OFFICIAL_CLI_SKILL_MAX_BYTES,
  OFFICIAL_CLI_SKILL_PUBLIC_KEY,
  type OfficialCliSkillPayload,
  type OfficialCliSkillRelease,
  officialCliSkillChannelSchema,
  officialCliSkillPayloadSchema,
  officialCliSkillReleaseSchema,
} from "@openmeld/schemas";
import { openMeldRootDir, resolveOpenMeldEnvPreset } from "../config/paths";
import { compareSemver } from "../config/version-state";
import { OPENMELD_VERSION } from "../runtime/version";
import { loadBundledSkillAssets } from "./bundled-assets";
import { withSkillsInstallLock } from "./install-lock";

const CACHE_FILE = "official-cli-skill.json";

export function verifyOfficialSkillRelease(value: unknown): {
  release: OfficialCliSkillRelease;
  payload: OfficialCliSkillPayload;
} {
  const envelope = officialCliSkillReleaseSchema.safeParse(value);
  if (
    !(
      envelope.success &&
      verify(
        null,
        Buffer.from(envelope.data.payload),
        OFFICIAL_CLI_SKILL_PUBLIC_KEY,
        Buffer.from(envelope.data.signature, "base64")
      )
    )
  ) {
    throw new Error("OpenMeld Skill signature is invalid");
  }
  const payload = officialCliSkillPayloadSchema.safeParse(
    JSON.parse(envelope.data.payload)
  );
  if (!payload.success) {
    throw new Error("OpenMeld Skill content is invalid");
  }
  return { release: envelope.data, payload: payload.data };
}

function isCompatible(
  payload: OfficialCliSkillPayload,
  cliVersion = OPENMELD_VERSION
): boolean {
  return (
    payload.contractVersion === OFFICIAL_CLI_SKILL_CONTRACT &&
    compareSemver(cliVersion, payload.minimumCliVersion) >= 0
  );
}

export function selectOfficialSkillRelease(
  value: unknown,
  cliVersion = OPENMELD_VERSION
) {
  const channel = officialCliSkillChannelSchema.safeParse(value);
  if (!channel.success) {
    throw new Error("OpenMeld Skill channel is invalid");
  }
  return (
    channel.data.releases
      .map(verifyOfficialSkillRelease)
      .filter(({ payload }) => isCompatible(payload, cliVersion))
      .sort((a, b) => b.payload.revision - a.payload.revision)[0] ?? null
  );
}

async function readCachedRelease() {
  const raw = await readFile(join(openMeldRootDir(), CACHE_FILE), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  );
  if (!raw) {
    return null;
  }
  try {
    return verifyOfficialSkillRelease(JSON.parse(raw));
  } catch (error) {
    process.stderr.write(
      `[openmeld] cached Skill rejected: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return null;
  }
}

// Local-only selection is shared by install, prompt, and component status.
export async function loadSelectedSkillAssets() {
  const cached = await readCachedRelease();
  if (!(cached && isCompatible(cached.payload))) {
    return {
      assets: await loadBundledSkillAssets(),
      version: OPENMELD_VERSION,
    };
  }
  return {
    assets: [
      ...cached.payload.files.map((file) => ({
        relativePath: `openmeld-cli/${file.path}`,
        content: Buffer.from(file.content),
      })),
    ].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    version: `skill-r${cached.payload.revision}`,
    contentRelease: {
      revision: cached.payload.revision,
      minimumCliVersion: cached.payload.minimumCliVersion,
    },
  };
}

export async function readSelectedSkillDocument(path: string): Promise<string> {
  const { assets } = await loadSelectedSkillAssets();
  const asset = assets.find(
    (file) => file.relativePath === `openmeld-cli/${path}`
  );
  if (!asset) {
    throw new Error(`OpenMeld Skill document is missing: ${path}`);
  }
  return asset.content.toString("utf8");
}

export function resolveOfficialSkillChannelUrl(): string | null {
  if (resolveOpenMeldEnvPreset() === "prod") {
    return "https://openmeld.ai/skills/openmeld-cli/channel.json";
  }
  const override = process.env.OPENMELD_CLI_SKILL_CHANNEL_URL;
  if (!(override && process.env.OPENMELD_HOME)) {
    return null;
  }
  const url = new URL(override);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error("Isolated Skill updates require an explicit localhost URL");
  }
  return url.href;
}

export async function downloadOfficialSkillUpdate(): Promise<
  "updated" | "current" | "incompatible" | "lane_isolated"
> {
  const url = resolveOfficialSkillChannelUrl();
  if (!url) {
    return "lane_isolated";
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!(response.ok && response.body)) {
    throw new Error(`OpenMeld Skill download failed (HTTP ${response.status})`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > OFFICIAL_CLI_SKILL_MAX_BYTES) {
      throw new Error("OpenMeld Skill download exceeds the size limit");
    }
    chunks.push(chunk);
  }
  const selected = selectOfficialSkillRelease(
    JSON.parse(Buffer.concat(chunks).toString("utf8"))
  );
  if (!selected) {
    return "incompatible";
  }
  return withSkillsInstallLock(async () => {
    const cached = await readCachedRelease();
    if (cached && cached.payload.revision >= selected.payload.revision) {
      return "current";
    }
    await mkdir(openMeldRootDir(), { recursive: true });
    const cache = join(openMeldRootDir(), CACHE_FILE);
    const staged = `${cache}.${randomUUID()}.tmp`;
    try {
      await writeFile(staged, JSON.stringify(selected.release), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(staged, cache);
    } finally {
      await rm(staged, { force: true });
    }
    return "updated";
  });
}
