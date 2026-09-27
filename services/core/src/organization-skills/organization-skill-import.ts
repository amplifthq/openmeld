import {
  ORGANIZATION_SKILL_BUNDLE_MAX_BYTES,
  ORGANIZATION_SKILL_DESCRIPTION_MAX_CHARS,
  ORGANIZATION_SKILL_FILE_LIMIT,
  ORGANIZATION_SKILL_FILE_MAX_BYTES,
  ORGANIZATION_SKILL_REPOSITORY_PREVIEW_LIMIT,
  ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES,
  organizationSkillBundleSchema,
} from "@openmeld/schemas";
import type {
  OrganizationSkillBundle,
  OrganizationSkillFile,
  OrganizationSkillGitHubSource,
} from "@openmeld/schemas/types";
import { loadYamlRuntime } from "../lazy-runtime-modules";
import { createCoreRpcHttpError } from "../rpc/errors";

const GIT_SUFFIX_PATTERN = /\.git$/;
const GITHUB_COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const GITHUB_PUBLIC_FALLBACK_STATUSES = new Set([401, 403, 404]);
const LEADING_LINE_BREAK_PATTERN = /^\r?\n/;
const GITHUB_TREE_FALLBACK_MAX_REQUESTS = 256;
const GITHUB_TREE_FALLBACK_MAX_ITEMS = 100_000;

type GitHubTreeItem = {
  mode?: string;
  path?: string;
  sha?: string;
  size?: number;
  type?: string;
};

type GitHubLocation = {
  owner: string;
  path: string | null;
  ref: string | null;
  repositoryUrl: string;
  repo: string;
};

type ParseYaml = (source: string) => unknown;

export async function parseOrganizationSkillBundleFromFiles(
  files: OrganizationSkillFile[]
): Promise<OrganizationSkillBundle> {
  if (
    files.reduce((total, file) => total + file.size, 0) >
    ORGANIZATION_SKILL_BUNDLE_MAX_BYTES
  ) {
    throw skillImportError(
      "organization_skill.bundle_too_large",
      "This Skill is too large to install."
    );
  }
  const skillMarkdown = files.filter((file) => file.path === "SKILL.md");
  if (skillMarkdown.length !== 1 || skillMarkdown[0]?.encoding !== "utf8") {
    throw skillImportError(
      "organization_skill.skill_markdown_missing",
      "Choose a directory with one UTF-8 SKILL.md at its root."
    );
  }
  if (
    new TextEncoder().encode(skillMarkdown[0].content).byteLength !==
    skillMarkdown[0].size
  ) {
    throw skillImportError(
      "organization_skill.invalid_bundle",
      "SKILL.md size does not match its content."
    );
  }
  if (
    files.some(
      (file) => file.path !== "SKILL.md" && file.path.endsWith("/SKILL.md")
    )
  ) {
    throw skillImportError(
      "organization_skill.invalid_bundle",
      "Choose one Skill directory without nested Skill packages."
    );
  }
  const { parse: parseYaml } = await loadYamlRuntime();
  const parsed = parseSkillMarkdown(skillMarkdown[0].content, parseYaml);
  const bundle = {
    files: files.filter((file) => file.path !== "SKILL.md"),
    instructions: parsed.instructions,
    portable: parsed.portable,
  };
  const validated = organizationSkillBundleSchema.safeParse(bundle);
  if (!validated.success) {
    throw skillImportError(
      "organization_skill.invalid_bundle",
      "The selected Skill files do not form a valid portable Skill."
    );
  }
  return validated.data;
}

export async function importOrganizationSkillBundleFromGitHub(input: {
  expectedCommitSha?: string;
  fetch?: typeof fetch;
  githubToken?: string;
  url: string;
}): Promise<{
  bundle: OrganizationSkillBundle;
  source: OrganizationSkillGitHubSource;
}> {
  const selected = await readSelectedGitHubSkill(input);
  const {
    commitSha,
    files,
    location,
    parsed,
    skillDirectory,
    skillMarkdownBytes,
    skillMarkdownPath,
  } = selected;
  const fetchImpl = input.fetch ?? fetch;

  let totalBytes = skillMarkdownBytes.byteLength;
  const bundleFiles: OrganizationSkillBundle["files"] = [];
  for (const item of files) {
    const fullPath = requireTreePath(item);
    if (fullPath === skillMarkdownPath) {
      continue;
    }
    const bytes = await readRawFile(
      fetchImpl,
      location,
      commitSha,
      fullPath,
      item.size as number
    );
    totalBytes += bytes.byteLength;
    if (totalBytes > ORGANIZATION_SKILL_BUNDLE_MAX_BYTES) {
      throw skillImportError(
        "organization_skill.bundle_too_large",
        "This Skill is too large to install."
      );
    }
    const relativePath =
      skillDirectory.length === 0
        ? fullPath
        : fullPath.slice(skillDirectory.length + 1);
    const decoded = decodeOptionalUtf8(bytes);
    bundleFiles.push({
      content: decoded ?? bytesToBase64(bytes),
      encoding: decoded === null ? "base64" : "utf8",
      mediaType: inferMediaType(relativePath, decoded !== null),
      path: relativePath,
      size: bytes.byteLength,
    });
  }

  const bundle = organizationSkillBundleSchema.safeParse({
    files: bundleFiles,
    instructions: parsed.instructions,
    portable: parsed.portable,
  });
  if (!bundle.success) {
    throw skillImportError(
      "organization_skill.invalid_bundle",
      bundle.error.issues[0]?.message ?? "The GitHub Skill is invalid."
    );
  }
  return {
    bundle: bundle.data,
    source: selected.source,
  };
}

export async function previewOrganizationSkillFromGitHub(input: {
  fetch?: typeof fetch;
  githubToken?: string;
  url: string;
}): Promise<{
  files: Array<{ path: string; size: number }>;
  instructionsCharacters: number;
  portable: OrganizationSkillBundle["portable"];
  source: OrganizationSkillGitHubSource;
  warnings: string[];
}> {
  const selected = await readSelectedGitHubSkill(input);
  const files = selected.files
    .filter((item) => item.path !== selected.skillMarkdownPath)
    .map((item) => ({
      path: selected.skillDirectory
        ? requireTreePath(item).slice(selected.skillDirectory.length + 1)
        : requireTreePath(item),
      size: item.size as number,
    }));
  return {
    files,
    instructionsCharacters: selected.parsed.instructions.length,
    portable: selected.parsed.portable,
    source: selected.source,
    warnings: [
      ...(files.some((file) => file.path.startsWith("scripts/"))
        ? [
            "Scripts are stored for portability but are not executable in OpenMeld Phase 1.",
          ]
        : []),
      ...(selected.parsed.portable.allowedTools !== null
        ? [
            "The allowed-tools field is preserved but does not grant OpenMeld permissions.",
          ]
        : []),
    ],
  };
}

async function readSelectedGitHubSkill(input: {
  expectedCommitSha?: string;
  fetch?: typeof fetch;
  githubToken?: string;
  url: string;
}): Promise<{
  commitSha: string;
  files: GitHubTreeItem[];
  location: GitHubLocation;
  parsed: {
    instructions: string;
    portable: OrganizationSkillBundle["portable"];
  };
  skillDirectory: string;
  skillMarkdownBytes: Uint8Array;
  skillMarkdownPath: string;
  source: OrganizationSkillGitHubSource;
}> {
  const fetchImpl = input.fetch ?? fetch;
  const githubToken = input.githubToken?.trim() || undefined;
  const location = parseGitHubLocation(input.url);
  const ref =
    location.ref ?? (await readDefaultBranch(fetchImpl, location, githubToken));
  const commitSha = await resolveCommitSha(
    fetchImpl,
    location,
    ref,
    githubToken
  );
  if (input.expectedCommitSha && input.expectedCommitSha !== commitSha) {
    throw skillImportError(
      "organization_skill.github_source_changed",
      "The GitHub source changed after it was previewed. Review the latest version before installing."
    );
  }
  const tree = await readGitTree(fetchImpl, location, commitSha, githubToken);
  const skillMarkdownPath = selectSkillMarkdownPath(tree, location.path);
  const skillDirectory = parentPath(skillMarkdownPath);
  const files = filesInSkillDirectory(
    tree,
    skillDirectory,
    skillDirectories(tree)
  );
  requireSafeGitHubFileDeclarations(files);
  const skillMarkdownFile = files.find(
    (item) => item.path === skillMarkdownPath
  );
  if (!skillMarkdownFile) {
    throw skillImportError(
      "organization_skill.skill_markdown_missing",
      "The selected GitHub directory does not contain SKILL.md."
    );
  }
  const skillMarkdownBytes = await readRawFile(
    fetchImpl,
    location,
    commitSha,
    skillMarkdownPath,
    skillMarkdownFile.size as number
  );
  const { parse: parseYaml } = await loadYamlRuntime();
  const parsed = parseSkillMarkdown(
    decodeRequiredUtf8(skillMarkdownBytes, skillMarkdownPath),
    parseYaml
  );
  return {
    commitSha,
    files,
    location,
    parsed,
    skillDirectory,
    skillMarkdownBytes,
    skillMarkdownPath,
    source: {
      commitSha,
      kind: "github",
      path: skillDirectory,
      repository: location.repositoryUrl,
    },
  };
}

export async function previewOrganizationSkillRepositoryFromGitHub(input: {
  fetch?: typeof fetch;
  githubToken?: string;
  url: string;
}): Promise<{
  commitSha: string;
  catalogLimitBytes: number;
  repository: string;
  totalDeclaredBytes: number;
  warnings: string[];
  skills: Array<{
    fileCount: number;
    path: string;
    totalBytes: number;
    url: string;
    warnings: string[];
    blocker: { code: string; message: string } | null;
  }>;
}> {
  const fetchImpl = input.fetch ?? fetch;
  const githubToken = input.githubToken?.trim() || undefined;
  const location = parseGitHubLocation(input.url);
  const ref =
    location.ref ?? (await readDefaultBranch(fetchImpl, location, githubToken));
  const commitSha = await resolveCommitSha(
    fetchImpl,
    location,
    ref,
    githubToken
  );
  const tree = await readGitTree(fetchImpl, location, commitSha, githubToken);
  const allSkillPaths = skillDirectories(tree);
  const skillPaths = allSkillPaths.filter(
    (path) =>
      location.path === null ||
      (location.path === "" && path === "") ||
      location.path === (path ? `${path}/SKILL.md` : "SKILL.md") ||
      (path !== "" &&
        (path === location.path || path.startsWith(`${location.path}/`)))
  );
  if (skillPaths.length === 0) {
    throw skillImportError(
      "organization_skill.skill_markdown_missing",
      "This repository does not contain a Skill in the selected path."
    );
  }
  if (skillPaths.length > ORGANIZATION_SKILL_REPOSITORY_PREVIEW_LIMIT) {
    throw skillImportError(
      "organization_skill.github_tree_too_large",
      `This repository has ${skillPaths.length} Skills; the review limit is ${ORGANIZATION_SKILL_REPOSITORY_PREVIEW_LIMIT}. Select a narrower directory.`
    );
  }
  const skills = skillPaths.map((path) => {
    const files = filesInSkillDirectory(tree, path, allSkillPaths);
    const totalBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
    let blocker: { code: string; message: string } | null = null;
    try {
      requireSafeGitHubFileDeclarations(files);
    } catch (error) {
      const cause =
        error instanceof Error
          ? (error.cause as { code?: string; message?: string } | undefined)
          : undefined;
      if (!(cause?.code && cause.message)) {
        throw error;
      }
      blocker = { code: cause.code, message: cause.message };
    }
    return {
      blocker,
      fileCount: files.length,
      path,
      totalBytes,
      url: path
        ? `${location.repositoryUrl}/tree/${commitSha}/${path.split("/").map(encodeURIComponent).join("/")}`
        : `${location.repositoryUrl}/blob/${commitSha}/SKILL.md`,
      warnings: files.some((file) =>
        file.path?.startsWith(path ? `${path}/scripts/` : "scripts/")
      )
        ? [
            "Scripts are stored for portability but are not executable in OpenMeld Phase 1.",
          ]
        : [],
    };
  });
  const totalDeclaredBytes = skills.reduce(
    (sum, skill) => sum + skill.totalBytes,
    0
  );
  return {
    catalogLimitBytes: ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES,
    commitSha,
    repository: location.repositoryUrl,
    totalDeclaredBytes,
    warnings: [
      "This file inventory is a preflight. Preview each Skill to validate its content before installing.",
    ],
    skills,
  };
}

function skillDirectories(tree: GitHubTreeItem[]): string[] {
  return tree
    .filter(
      (item) =>
        item.type === "blob" &&
        typeof item.path === "string" &&
        (item.path === "SKILL.md" || item.path.endsWith("/SKILL.md"))
    )
    .map((item) => parentPath(requireTreePath(item)))
    .sort();
}

function filesInSkillDirectory(
  tree: GitHubTreeItem[],
  directory: string,
  allSkillDirectories: string[]
): GitHubTreeItem[] {
  const nestedDirectories = allSkillDirectories.filter(
    (path) =>
      path !== directory && path.startsWith(directory ? `${directory}/` : "")
  );
  return tree.filter((item) => {
    if (item.type !== "blob" || typeof item.path !== "string") {
      return false;
    }
    if (directory && !item.path.startsWith(`${directory}/`)) {
      return false;
    }
    return !nestedDirectories.some((nested) =>
      item.path?.startsWith(`${nested}/`)
    );
  });
}

function requireSafeGitHubFileDeclarations(files: GitHubTreeItem[]): void {
  if (files.length > ORGANIZATION_SKILL_FILE_LIMIT + 1) {
    throw skillImportError(
      "organization_skill.file_limit_reached",
      `This Skill has ${files.length - 1} supporting files; the limit is ${ORGANIZATION_SKILL_FILE_LIMIT}.`
    );
  }
  if (files.some((item) => item.mode === "120000")) {
    throw skillImportError(
      "organization_skill.unsafe_bundle",
      "Skill bundles cannot contain symbolic links."
    );
  }
  const declaredTotalBytes = files.reduce((total, item) => {
    if (!Number.isInteger(item.size) || (item.size ?? -1) < 0) {
      throw skillImportError(
        "organization_skill.github_response_invalid",
        "GitHub did not return a valid size for every Skill file."
      );
    }
    if ((item.size ?? 0) > ORGANIZATION_SKILL_FILE_MAX_BYTES) {
      throw skillImportError(
        "organization_skill.bundle_too_large",
        `${requireTreePath(item)} is ${item.size} bytes; the single-file limit is ${ORGANIZATION_SKILL_FILE_MAX_BYTES} bytes.`
      );
    }
    return total + (item.size ?? 0);
  }, 0);
  if (declaredTotalBytes > ORGANIZATION_SKILL_BUNDLE_MAX_BYTES) {
    throw skillImportError(
      "organization_skill.bundle_too_large",
      `This Skill is ${declaredTotalBytes} bytes; the bundle limit is ${ORGANIZATION_SKILL_BUNDLE_MAX_BYTES} bytes.`
    );
  }
}

function parseGitHubLocation(input: string): GitHubLocation {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw skillImportError(
      "organization_skill.github_url_invalid",
      "Enter a valid GitHub repository or Skill URL."
    );
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw skillImportError(
      "organization_skill.github_url_invalid",
      "Organization Skills can be installed only from github.com URLs."
    );
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw skillImportError(
      "organization_skill.github_url_invalid",
      "Enter a GitHub repository or Skill directory URL."
    );
  }
  const owner = segments[0] ?? "";
  const repo = (segments[1] ?? "").replace(GIT_SUFFIX_PATTERN, "");
  const kind = segments[2];
  if (kind && kind !== "tree" && kind !== "blob") {
    throw skillImportError(
      "organization_skill.github_url_invalid",
      "Use a GitHub repository, tree, or SKILL.md URL."
    );
  }
  const ref = kind ? (segments[3] ?? null) : url.searchParams.get("ref");
  let sourcePath: string | null = null;
  if (kind) {
    try {
      const pathSegments = segments.slice(4).map(decodeURIComponent);
      if (
        pathSegments.some(
          (segment) =>
            segment === "." ||
            segment === ".." ||
            segment.includes("/") ||
            segment.includes("\\")
        )
      ) {
        throw new Error("Invalid GitHub path segment.");
      }
      sourcePath = pathSegments.join("/");
    } catch {
      throw skillImportError(
        "organization_skill.github_url_invalid",
        "Enter a valid GitHub Skill directory URL."
      );
    }
  }
  let path = sourcePath || null;
  if (
    kind === "blob" &&
    (sourcePath === "SKILL.md" || sourcePath?.endsWith("/SKILL.md"))
  ) {
    path = parentPath(sourcePath);
  }
  return {
    owner,
    path,
    ref,
    repo,
    repositoryUrl: `https://github.com/${owner}/${repo}`,
  };
}

async function readDefaultBranch(
  fetchImpl: typeof fetch,
  location: GitHubLocation,
  githubToken: string | undefined
): Promise<string> {
  const response = await githubApiFetch(
    fetchImpl,
    `/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}`,
    githubToken
  );
  const value = (await response.json()) as { default_branch?: unknown };
  if (typeof value.default_branch !== "string") {
    throw skillImportError(
      "organization_skill.github_response_invalid",
      "GitHub did not return a default branch."
    );
  }
  return value.default_branch;
}

async function resolveCommitSha(
  fetchImpl: typeof fetch,
  location: GitHubLocation,
  ref: string,
  githubToken: string | undefined
): Promise<string> {
  const response = await githubApiFetch(
    fetchImpl,
    `/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/commits/${encodeURIComponent(ref)}`,
    githubToken
  );
  const value = (await response.json()) as { sha?: unknown };
  if (
    typeof value.sha !== "string" ||
    !GITHUB_COMMIT_SHA_PATTERN.test(value.sha)
  ) {
    throw skillImportError(
      "organization_skill.github_response_invalid",
      "GitHub did not return an immutable commit."
    );
  }
  return value.sha;
}

async function readGitTree(
  fetchImpl: typeof fetch,
  location: GitHubLocation,
  commitSha: string,
  githubToken: string | undefined
): Promise<GitHubTreeItem[]> {
  const response = await githubApiFetch(
    fetchImpl,
    `/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/git/trees/${commitSha}?recursive=1`,
    githubToken
  );
  const value = (await response.json()) as {
    sha?: unknown;
    tree?: unknown;
    truncated?: unknown;
  };
  if (value.truncated === true) {
    if (
      typeof value.sha !== "string" ||
      !GITHUB_COMMIT_SHA_PATTERN.test(value.sha)
    ) {
      throw skillImportError(
        "organization_skill.github_response_invalid",
        "GitHub did not return a tree identity for this repository."
      );
    }
    return await readGitTreeBySubtree(
      fetchImpl,
      location,
      value.sha,
      githubToken
    );
  }
  if (!Array.isArray(value.tree)) {
    throw skillImportError(
      "organization_skill.github_response_invalid",
      "GitHub did not return a repository tree."
    );
  }
  return value.tree as GitHubTreeItem[];
}

async function readGitTreeBySubtree(
  fetchImpl: typeof fetch,
  location: GitHubLocation,
  rootTreeSha: string,
  githubToken: string | undefined
): Promise<GitHubTreeItem[]> {
  const selectedDirectory = location.path ?? "";
  const pending = [{ path: "", sha: rootTreeSha }];
  const files: GitHubTreeItem[] = [];
  let requests = 0;
  let seenItems = 0;
  while (pending.length > 0) {
    if (++requests > GITHUB_TREE_FALLBACK_MAX_REQUESTS) {
      throw skillImportError(
        "organization_skill.github_tree_too_large",
        "This repository has too many directories to inspect. Select a narrower Skill directory."
      );
    }
    const directory = pending.shift();
    if (!directory) {
      break;
    }
    const items = await readCompleteGitTreeDirectory(
      fetchImpl,
      location,
      directory.sha,
      githubToken
    );
    seenItems += items.length;
    if (seenItems > GITHUB_TREE_FALLBACK_MAX_ITEMS) {
      throw skillImportError(
        "organization_skill.github_tree_too_large",
        "This repository has too many files to inspect. Select a narrower Skill directory."
      );
    }
    for (const item of items) {
      const entry = classifyGitTreeItem(
        item,
        directory.path,
        selectedDirectory
      );
      if (entry?.kind === "directory") {
        pending.push({ path: entry.path, sha: entry.sha });
      } else if (entry?.kind === "file") {
        files.push(entry.file);
      }
    }
  }
  return files;
}

async function readCompleteGitTreeDirectory(
  fetchImpl: typeof fetch,
  location: GitHubLocation,
  sha: string,
  githubToken: string | undefined
): Promise<GitHubTreeItem[]> {
  const response = await githubApiFetch(
    fetchImpl,
    `/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/git/trees/${sha}`,
    githubToken
  );
  const value = (await response.json()) as {
    tree?: unknown;
    truncated?: unknown;
  };
  if (value.truncated === true || !Array.isArray(value.tree)) {
    throw skillImportError(
      "organization_skill.github_tree_too_large",
      "GitHub did not return a complete directory. Select a narrower Skill directory."
    );
  }
  return value.tree as GitHubTreeItem[];
}

function classifyGitTreeItem(
  item: GitHubTreeItem,
  parent: string,
  selectedDirectory: string
):
  | { kind: "directory"; path: string; sha: string }
  | { kind: "file"; file: GitHubTreeItem }
  | null {
  const name = requireTreePath(item);
  if (!name || name === "." || name === ".." || name.includes("/")) {
    throw skillImportError(
      "organization_skill.github_response_invalid",
      "GitHub returned an invalid repository path."
    );
  }
  const path = parent ? `${parent}/${name}` : name;
  if (item.type === "blob") {
    if (selectedDirectory && !path.startsWith(`${selectedDirectory}/`)) {
      return null;
    }
    return { kind: "file", file: { ...item, path } };
  }
  if (item.type !== "tree") {
    return null;
  }
  if (
    selectedDirectory &&
    path !== selectedDirectory &&
    !path.startsWith(`${selectedDirectory}/`) &&
    !selectedDirectory.startsWith(`${path}/`)
  ) {
    return null;
  }
  if (
    typeof item.sha !== "string" ||
    !GITHUB_COMMIT_SHA_PATTERN.test(item.sha)
  ) {
    throw skillImportError(
      "organization_skill.github_response_invalid",
      "GitHub did not return a tree identity for this directory."
    );
  }
  return { kind: "directory", path, sha: item.sha };
}

function selectSkillMarkdownPath(
  tree: GitHubTreeItem[],
  requestedPath: string | null
): string {
  if (requestedPath !== null) {
    let candidate = requestedPath || "SKILL.md";
    if (
      requestedPath &&
      requestedPath !== "SKILL.md" &&
      !requestedPath.endsWith("/SKILL.md")
    ) {
      candidate = `${requestedPath}/SKILL.md`;
    }
    if (tree.some((item) => item.type === "blob" && item.path === candidate)) {
      return candidate;
    }
    throw skillImportError(
      "organization_skill.skill_markdown_missing",
      "The selected GitHub directory does not contain SKILL.md."
    );
  }
  const candidates = tree.filter(
    (item) =>
      item.type === "blob" &&
      typeof item.path === "string" &&
      (item.path === "SKILL.md" || item.path.endsWith("/SKILL.md"))
  );
  if (candidates.length === 0) {
    throw skillImportError(
      "organization_skill.skill_markdown_missing",
      "This repository does not contain a Skill."
    );
  }
  if (candidates.length !== 1) {
    throw skillImportError(
      "organization_skill.github_selection_required",
      "This repository contains multiple Skills. Use the exact Skill directory URL."
    );
  }
  return requireTreePath(candidates[0]);
}

async function readRawFile(
  fetchImpl: typeof fetch,
  location: GitHubLocation,
  commitSha: string,
  path: string,
  declaredSize: number
): Promise<Uint8Array> {
  const response = await fetchImpl(
    `https://raw.githubusercontent.com/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/${commitSha}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    { headers: { "User-Agent": "OpenMeld Organization Skills" } }
  );
  if (!response.ok) {
    throw skillImportError(
      "organization_skill.github_unavailable",
      `GitHub could not read ${path}.`
    );
  }
  if (!response.body) {
    throw skillImportError(
      "organization_skill.github_response_invalid",
      `GitHub returned no content for ${path}.`
    );
  }
  const bytes = new Uint8Array(declaredSize);
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (received + result.value.byteLength > declaredSize) {
        await reader.cancel();
        throw skillImportError(
          "organization_skill.github_response_invalid",
          `GitHub returned more content than declared for ${path}.`
        );
      }
      bytes.set(result.value, received);
      received += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (received !== declaredSize) {
    throw skillImportError(
      "organization_skill.github_response_invalid",
      `GitHub returned ${received} bytes for ${path}; ${declaredSize} were declared.`
    );
  }
  return bytes;
}

async function githubApiFetch(
  fetchImpl: typeof fetch,
  path: string,
  githubToken: string | undefined
): Promise<Response> {
  const url = `https://api.github.com${path}`;
  let response = await fetchImpl(url, {
    headers: githubApiHeaders(githubToken),
  });
  if (githubToken && GITHUB_PUBLIC_FALLBACK_STATUSES.has(response.status)) {
    response = await fetchImpl(url, {
      headers: githubApiHeaders(),
    });
  }
  if (!response.ok) {
    throw skillImportError(
      "organization_skill.github_unavailable",
      response.status === 404
        ? "The GitHub repository, ref, or Skill directory was not found."
        : "GitHub is temporarily unavailable."
    );
  }
  return response;
}

function githubApiHeaders(githubToken?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    "User-Agent": "OpenMeld Organization Skills",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function parseSkillMarkdown(
  value: string,
  parseYaml: ParseYaml
): {
  instructions: string;
  portable: OrganizationSkillBundle["portable"];
} {
  if (!value.startsWith("---\n")) {
    throw skillImportError(
      "organization_skill.frontmatter_invalid",
      "SKILL.md must start with YAML frontmatter."
    );
  }
  const end = value.indexOf("\n---", 4);
  if (end < 0) {
    throw skillImportError(
      "organization_skill.frontmatter_invalid",
      "SKILL.md frontmatter is not closed."
    );
  }
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(value.slice(4, end));
  } catch {
    throw skillImportError(
      "organization_skill.frontmatter_invalid",
      "SKILL.md frontmatter is not valid YAML."
    );
  }
  if (!frontmatter || typeof frontmatter !== "object") {
    throw skillImportError(
      "organization_skill.frontmatter_invalid",
      "SKILL.md frontmatter must be an object."
    );
  }
  const source = frontmatter as Record<string, unknown>;
  const description = String(source.description ?? "");
  if (description.length > ORGANIZATION_SKILL_DESCRIPTION_MAX_CHARS) {
    throw skillImportError(
      "organization_skill.frontmatter_invalid",
      `SKILL.md description exceeds the Agent Skills ${ORGANIZATION_SKILL_DESCRIPTION_MAX_CHARS}-character limit.`
    );
  }
  const metadata =
    source.metadata && typeof source.metadata === "object"
      ? Object.fromEntries(
          Object.entries(source.metadata as Record<string, unknown>).map(
            ([key, item]) => [key, String(item)]
          )
        )
      : {};
  return {
    instructions: value.slice(end + 4).replace(LEADING_LINE_BREAK_PATTERN, ""),
    portable: {
      allowedTools: optionalString(source["allowed-tools"]),
      compatibility: optionalString(source.compatibility),
      description,
      license: optionalString(source.license),
      metadata,
      name: String(source.name ?? ""),
    },
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parentPath(value: string): string {
  const index = value.lastIndexOf("/");
  return index < 0 ? "" : value.slice(0, index);
}

function requireTreePath(item: GitHubTreeItem | undefined): string {
  if (!item || typeof item.path !== "string") {
    throw skillImportError(
      "organization_skill.github_response_invalid",
      "GitHub returned an invalid repository path."
    );
  }
  return item.path;
}

function decodeRequiredUtf8(bytes: Uint8Array, path: string): string {
  const decoded = decodeOptionalUtf8(bytes);
  if (decoded === null) {
    throw skillImportError(
      "organization_skill.skill_markdown_invalid",
      `${path} must be UTF-8 text.`
    );
  }
  return decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
}

function decodeOptionalUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function inferMediaType(path: string, isText: boolean): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const known: Record<string, string> = {
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    json: "application/json",
    md: "text/markdown",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain",
    webp: "image/webp",
    yaml: "application/yaml",
    yml: "application/yaml",
  };
  return (
    (extension && known[extension]) ||
    (isText ? "text/plain" : "application/octet-stream")
  );
}

function skillImportError(code: string, reason: string) {
  return createCoreRpcHttpError({ code, reason, status: 400 });
}
