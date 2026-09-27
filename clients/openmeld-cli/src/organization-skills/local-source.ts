import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import {
  ORGANIZATION_SKILL_BUNDLE_MAX_BYTES,
  ORGANIZATION_SKILL_FILE_LIMIT,
  ORGANIZATION_SKILL_FILE_MAX_BYTES,
  organizationSkillFileSchema,
} from "@openmeld/schemas";
import type { OrganizationSkillFile } from "@openmeld/schemas/types";

const mediaTypes: Record<string, string> = {
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
};

export async function readLocalSkillFiles(
  directory: string
): Promise<OrganizationSkillFile[]> {
  const root = resolve(directory);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) {
    throw new Error("Choose a Skill directory containing SKILL.md.");
  }
  const paths = await listLocalSkillPaths(root);
  if (paths.length > ORGANIZATION_SKILL_FILE_LIMIT + 1) {
    throw new Error(
      `This Skill has too many files. The limit is ${ORGANIZATION_SKILL_FILE_LIMIT} supporting files.`
    );
  }
  const files: OrganizationSkillFile[] = [];
  let totalBytes = 0;
  for (const absolute of paths) {
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(
        `Skill file changed while it was being read: ${absolute}`
      );
    }
    if (info.size > ORGANIZATION_SKILL_FILE_MAX_BYTES) {
      throw new Error(
        `${absolute} exceeds the ${ORGANIZATION_SKILL_FILE_MAX_BYTES}-byte single-file limit.`
      );
    }
    totalBytes += info.size;
    if (totalBytes > ORGANIZATION_SKILL_BUNDLE_MAX_BYTES) {
      throw new Error(
        `This Skill exceeds the ${ORGANIZATION_SKILL_BUNDLE_MAX_BYTES}-byte package limit.`
      );
    }
    files.push(await readLocalSkillFile(root, absolute, info.size));
  }
  if (!files.some((file) => file.path === "SKILL.md")) {
    throw new Error(
      "Choose a Skill directory containing SKILL.md at its root."
    );
  }
  return files;
}

async function listLocalSkillPaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = (await readdir(current, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
      const absolute = join(current, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        throw new Error(
          `Skill packages cannot contain symbolic links: ${absolute}`
        );
      }
      if (info.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!info.isFile()) {
        throw new Error(
          `Skill packages can contain only regular files: ${absolute}`
        );
      }
      paths.push(absolute);
      if (paths.length > ORGANIZATION_SKILL_FILE_LIMIT + 1) {
        return;
      }
    }
  };
  await visit(root);
  return paths;
}

async function readLocalSkillFile(
  root: string,
  absolute: string,
  expectedSize: number
): Promise<OrganizationSkillFile> {
  const bytes = await readFile(absolute);
  if (bytes.byteLength !== expectedSize) {
    throw new Error(`${absolute} changed while it was being read. Try again.`);
  }
  let decoded: string | null;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    decoded = null;
  }
  const path = relative(root, absolute).split(sep).join("/");
  const file = organizationSkillFileSchema.safeParse({
    content: decoded ?? bytes.toString("base64"),
    encoding: decoded === null ? "base64" : "utf8",
    mediaType:
      mediaTypes[extname(path).toLowerCase()] ??
      (decoded === null ? "application/octet-stream" : "text/plain"),
    path,
    size: bytes.byteLength,
  });
  if (!file.success) {
    throw new Error(`${absolute} is not a valid portable Skill file.`);
  }
  return file.data;
}
