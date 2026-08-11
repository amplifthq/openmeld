import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  organizationSkillBundleSchema,
  stringifyOrganizationSkillBundleCanonicalJson,
} from "@openmeld/schemas";
import type {
  OrganizationSkillBundle,
  OrganizationSkillFile,
} from "@openmeld/schemas/types";
import { organizationSkillReleaseDir } from "../config/paths";

const CACHE_MARKER_FILENAME = ".openmeld-organization-skill.json";
const DIRECTORY_READ_ONLY_MODE = 0o555;
const FILE_READ_ONLY_MODE = 0o444;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

type OrganizationSkillCacheMarker = {
  digest: string;
  organizationId: string;
  releaseId: string;
  schemaVersion: 1;
  skillId: string;
};

export type MaterializedOrganizationSkillRelease = {
  cachePath: string;
  resourcePaths: string[];
  reused: boolean;
  skillMarkdownPath: string;
};

export async function materializeOrganizationSkillRelease(input: {
  bundle: OrganizationSkillBundle;
  digest: string;
  organizationId: string;
  releaseId: string;
  skillId: string;
}): Promise<MaterializedOrganizationSkillRelease> {
  const bundle = organizationSkillBundleSchema.parse(input.bundle);
  const actualDigest = sha256(
    stringifyOrganizationSkillBundleCanonicalJson(bundle)
  );
  if (actualDigest !== input.digest) {
    throw new Error(
      "The Organization Skill release digest does not match its downloaded bundle."
    );
  }

  const releaseDir = organizationSkillReleaseDir(
    input.organizationId,
    input.skillId,
    input.releaseId
  );
  const skillMarkdown = serializePortableSkillMarkdown(bundle);
  const expectedFiles = buildExpectedCacheFiles({
    bundle,
    marker: {
      digest: input.digest,
      organizationId: input.organizationId,
      releaseId: input.releaseId,
      schemaVersion: 1,
      skillId: input.skillId,
    },
    skillMarkdown,
  });
  if (await cacheMatches(releaseDir, expectedFiles)) {
    return buildResult({ bundle, releaseDir, reused: true });
  }

  const skillDir = dirname(releaseDir);
  await mkdir(skillDir, {
    mode: PRIVATE_DIRECTORY_MODE,
    recursive: true,
  });
  await chmod(skillDir, PRIVATE_DIRECTORY_MODE);
  const temporaryDir = await mkdtemp(join(skillDir, `.load-${randomUUID()}-`));
  try {
    await writeCacheFiles(temporaryDir, expectedFiles);
    await makeCacheReadOnly(temporaryDir, bundle);
    if (await pathExists(releaseDir)) {
      throw new Error(
        `The existing Organization Skill cache is not valid. Remove "${releaseDir}" and run the load command again.`
      );
    }
    await rename(temporaryDir, releaseDir);
  } catch (error) {
    await rm(temporaryDir, { force: true, recursive: true }).catch(() => {
      // Preserve the original load failure; this private temporary cache has
      // no authority and can be cleaned by a later load.
    });
    throw error;
  }
  return buildResult({ bundle, releaseDir, reused: false });
}

export function serializePortableSkillMarkdown(
  bundle: OrganizationSkillBundle
): string {
  const portable = bundle.portable;
  const frontmatter = [
    "---",
    `name: ${toYamlString(portable.name)}`,
    `description: ${toYamlString(portable.description)}`,
    ...(portable.license === null
      ? []
      : [`license: ${toYamlString(portable.license)}`]),
    ...(portable.compatibility === null
      ? []
      : [`compatibility: ${toYamlString(portable.compatibility)}`]),
    ...(portable.allowedTools === null
      ? []
      : [`allowed-tools: ${toYamlString(portable.allowedTools)}`]),
    ...serializeMetadata(portable.metadata),
    "---",
    "",
  ];
  return `${frontmatter.join("\n")}${bundle.instructions}${
    bundle.instructions.endsWith("\n") ? "" : "\n"
  }`;
}

function buildExpectedCacheFiles(input: {
  bundle: OrganizationSkillBundle;
  marker: OrganizationSkillCacheMarker;
  skillMarkdown: string;
}): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  files.set("SKILL.md", Buffer.from(input.skillMarkdown, "utf8"));
  for (const file of input.bundle.files) {
    files.set(file.path, decodeSkillFile(file));
  }
  files.set(
    CACHE_MARKER_FILENAME,
    Buffer.from(`${JSON.stringify(input.marker, null, 2)}\n`, "utf8")
  );
  return files;
}

async function writeCacheFiles(
  rootDir: string,
  files: ReadonlyMap<string, Buffer>
): Promise<void> {
  for (const [relativePath, bytes] of files) {
    const absolutePath = join(rootDir, relativePath);
    await mkdir(dirname(absolutePath), {
      mode: PRIVATE_DIRECTORY_MODE,
      recursive: true,
    });
    await writeFile(absolutePath, bytes, { mode: PRIVATE_FILE_MODE });
  }
}

async function cacheMatches(
  rootDir: string,
  expectedFiles: ReadonlyMap<string, Buffer>
): Promise<boolean> {
  if (!(await pathExists(rootDir))) {
    return false;
  }
  try {
    for (const [relativePath, expected] of expectedFiles) {
      const actual = await readFile(join(rootDir, relativePath));
      if (!actual.equals(expected)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function makeCacheReadOnly(
  rootDir: string,
  bundle: OrganizationSkillBundle
): Promise<void> {
  const directories = new Set<string>([rootDir]);
  for (const relativePath of [
    "SKILL.md",
    CACHE_MARKER_FILENAME,
    ...bundle.files.map((file) => file.path),
  ]) {
    const absolutePath = join(rootDir, relativePath);
    await chmod(absolutePath, FILE_READ_ONLY_MODE);
    let current = dirname(absolutePath);
    while (current !== rootDir && current.startsWith(`${rootDir}/`)) {
      directories.add(current);
      current = dirname(current);
    }
  }
  const deepestFirst = [...directories].sort(
    (left, right) => right.length - left.length
  );
  for (const directory of deepestFirst) {
    await chmod(directory, DIRECTORY_READ_ONLY_MODE);
  }
}

function buildResult(input: {
  bundle: OrganizationSkillBundle;
  releaseDir: string;
  reused: boolean;
}): MaterializedOrganizationSkillRelease {
  return {
    cachePath: input.releaseDir,
    resourcePaths: input.bundle.files.map((file) =>
      join(input.releaseDir, file.path)
    ),
    reused: input.reused,
    skillMarkdownPath: join(input.releaseDir, "SKILL.md"),
  };
}

function decodeSkillFile(file: OrganizationSkillFile): Buffer {
  return Buffer.from(
    file.content,
    file.encoding === "base64" ? "base64" : "utf8"
  );
}

function serializeMetadata(metadata: Record<string, string>): string[] {
  const entries = Object.entries(metadata).sort(([left], [right]) => {
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  });
  if (entries.length === 0) {
    return [];
  }
  return [
    "metadata:",
    ...entries.map(
      ([key, value]) => `  ${toYamlString(key)}: ${toYamlString(value)}`
    ),
  ];
}

function toYamlString(value: string): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
