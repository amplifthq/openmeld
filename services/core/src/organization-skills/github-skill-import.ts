import {
  ORGANIZATION_SKILL_BUNDLE_MAX_BYTES,
  ORGANIZATION_SKILL_FILE_LIMIT,
  ORGANIZATION_SKILL_FILE_MAX_BYTES,
  organizationSkillBundleSchema,
} from "@openmeld/schemas";
import type {
  OrganizationSkillBundle,
  OrganizationSkillGitHubSource,
} from "@openmeld/schemas/types";
import { parse as parseYaml } from "yaml";
import { createCoreRpcHttpError } from "../rpc/errors";

const GIT_SUFFIX_PATTERN = /\.git$/;
const GITHUB_COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const GITHUB_PUBLIC_FALLBACK_STATUSES = new Set([401, 403, 404]);
const LEADING_LINE_BREAK_PATTERN = /^\r?\n/;

type GitHubTreeItem = {
  mode?: string;
  path?: string;
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

export async function importOrganizationSkillBundleFromGitHub(input: {
  expectedCommitSha?: string;
  fetch?: typeof fetch;
  githubToken?: string;
  url: string;
}): Promise<{
  bundle: OrganizationSkillBundle;
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
  if (
    input.expectedCommitSha !== undefined &&
    input.expectedCommitSha !== commitSha
  ) {
    throw githubImportError(
      "organization_skill.github_source_changed",
      "The GitHub source changed after it was previewed. Review the latest version before installing."
    );
  }
  const tree = await readGitTree(fetchImpl, location, commitSha, githubToken);
  const skillMarkdownPath = selectSkillMarkdownPath(tree, location.path);
  const skillDirectory = parentPath(skillMarkdownPath);
  const files = tree.filter((item) => {
    if (item.type !== "blob" || typeof item.path !== "string") {
      return false;
    }
    return skillDirectory.length === 0
      ? !item.path.includes("/")
      : item.path.startsWith(`${skillDirectory}/`);
  });
  requireSafeGitHubFileDeclarations(files);

  let totalBytes = 0;
  let skillMarkdown = "";
  const bundleFiles: OrganizationSkillBundle["files"] = [];
  for (const item of files) {
    const fullPath = requireTreePath(item);
    const bytes = await readRawFile(fetchImpl, location, commitSha, fullPath);
    totalBytes += bytes.byteLength;
    if (totalBytes > ORGANIZATION_SKILL_BUNDLE_MAX_BYTES) {
      throw githubImportError(
        "organization_skill.bundle_too_large",
        "This Skill is too large to install."
      );
    }
    if (fullPath === skillMarkdownPath) {
      skillMarkdown = decodeRequiredUtf8(bytes, fullPath);
      continue;
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

  if (!skillMarkdown) {
    throw githubImportError(
      "organization_skill.skill_markdown_missing",
      "The selected GitHub directory does not contain SKILL.md."
    );
  }
  const parsed = parseSkillMarkdown(skillMarkdown);
  const bundle = organizationSkillBundleSchema.safeParse({
    files: bundleFiles,
    instructions: parsed.instructions,
    portable: parsed.portable,
  });
  if (!bundle.success) {
    throw githubImportError(
      "organization_skill.invalid_bundle",
      bundle.error.issues[0]?.message ?? "The GitHub Skill is invalid."
    );
  }
  return {
    bundle: bundle.data,
    source: {
      commitSha,
      kind: "github",
      path: skillDirectory,
      repository: location.repositoryUrl,
    },
  };
}

function requireSafeGitHubFileDeclarations(files: GitHubTreeItem[]): void {
  if (files.length > ORGANIZATION_SKILL_FILE_LIMIT + 1) {
    throw githubImportError(
      "organization_skill.file_limit_reached",
      "This Skill contains too many files."
    );
  }
  if (files.some((item) => item.mode === "120000")) {
    throw githubImportError(
      "organization_skill.unsafe_bundle",
      "Skill bundles cannot contain symbolic links."
    );
  }
  const declaredTotalBytes = files.reduce((total, item) => {
    if (!Number.isInteger(item.size) || (item.size ?? -1) < 0) {
      throw githubImportError(
        "organization_skill.github_response_invalid",
        "GitHub did not return a valid size for every Skill file."
      );
    }
    if ((item.size ?? 0) > ORGANIZATION_SKILL_FILE_MAX_BYTES) {
      throw githubImportError(
        "organization_skill.bundle_too_large",
        "This Skill contains a file that is too large to install."
      );
    }
    return total + (item.size ?? 0);
  }, 0);
  if (declaredTotalBytes > ORGANIZATION_SKILL_BUNDLE_MAX_BYTES) {
    throw githubImportError(
      "organization_skill.bundle_too_large",
      "This Skill is too large to install."
    );
  }
}

function parseGitHubLocation(input: string): GitHubLocation {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw githubImportError(
      "organization_skill.github_url_invalid",
      "Enter a valid GitHub repository or Skill URL."
    );
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw githubImportError(
      "organization_skill.github_url_invalid",
      "Organization Skills can be installed only from github.com URLs."
    );
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw githubImportError(
      "organization_skill.github_url_invalid",
      "Enter a GitHub repository or Skill directory URL."
    );
  }
  const owner = segments[0] ?? "";
  const repo = (segments[1] ?? "").replace(GIT_SUFFIX_PATTERN, "");
  const kind = segments[2];
  if (kind && kind !== "tree" && kind !== "blob") {
    throw githubImportError(
      "organization_skill.github_url_invalid",
      "Use a GitHub repository, tree, or SKILL.md URL."
    );
  }
  const ref = kind ? (segments[3] ?? null) : url.searchParams.get("ref");
  const sourcePath = kind ? segments.slice(4).join("/") : null;
  const path =
    kind === "blob" && sourcePath?.endsWith("/SKILL.md")
      ? parentPath(sourcePath)
      : sourcePath || null;
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
    throw githubImportError(
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
    throw githubImportError(
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
    tree?: unknown;
    truncated?: unknown;
  };
  if (value.truncated === true) {
    throw githubImportError(
      "organization_skill.github_tree_too_large",
      "This repository is too large to inspect safely."
    );
  }
  if (!Array.isArray(value.tree)) {
    throw githubImportError(
      "organization_skill.github_response_invalid",
      "GitHub did not return a repository tree."
    );
  }
  return value.tree as GitHubTreeItem[];
}

function selectSkillMarkdownPath(
  tree: GitHubTreeItem[],
  requestedPath: string | null
): string {
  if (requestedPath !== null) {
    const candidate =
      requestedPath === "SKILL.md" || requestedPath.endsWith("/SKILL.md")
        ? requestedPath
        : `${requestedPath}/SKILL.md`;
    if (tree.some((item) => item.type === "blob" && item.path === candidate)) {
      return candidate;
    }
    throw githubImportError(
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
    throw githubImportError(
      "organization_skill.skill_markdown_missing",
      "This repository does not contain a Skill."
    );
  }
  if (candidates.length !== 1) {
    throw githubImportError(
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
  path: string
): Promise<Uint8Array> {
  const response = await fetchImpl(
    `https://raw.githubusercontent.com/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/${commitSha}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    { headers: { "User-Agent": "OpenMeld Organization Skills" } }
  );
  if (!response.ok) {
    throw githubImportError(
      "organization_skill.github_unavailable",
      `GitHub could not read ${path}.`
    );
  }
  return new Uint8Array(await response.arrayBuffer());
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
    throw githubImportError(
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

function parseSkillMarkdown(value: string): {
  instructions: string;
  portable: OrganizationSkillBundle["portable"];
} {
  if (!value.startsWith("---\n")) {
    throw githubImportError(
      "organization_skill.frontmatter_invalid",
      "SKILL.md must start with YAML frontmatter."
    );
  }
  const end = value.indexOf("\n---", 4);
  if (end < 0) {
    throw githubImportError(
      "organization_skill.frontmatter_invalid",
      "SKILL.md frontmatter is not closed."
    );
  }
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(value.slice(4, end));
  } catch {
    throw githubImportError(
      "organization_skill.frontmatter_invalid",
      "SKILL.md frontmatter is not valid YAML."
    );
  }
  if (!frontmatter || typeof frontmatter !== "object") {
    throw githubImportError(
      "organization_skill.frontmatter_invalid",
      "SKILL.md frontmatter must be an object."
    );
  }
  const source = frontmatter as Record<string, unknown>;
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
      description: String(source.description ?? ""),
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
    throw githubImportError(
      "organization_skill.github_response_invalid",
      "GitHub returned an invalid repository path."
    );
  }
  return item.path;
}

function decodeRequiredUtf8(bytes: Uint8Array, path: string): string {
  const decoded = decodeOptionalUtf8(bytes);
  if (decoded === null) {
    throw githubImportError(
      "organization_skill.skill_markdown_invalid",
      `${path} must be UTF-8 text.`
    );
  }
  return decoded;
}

function decodeOptionalUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
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

function githubImportError(code: string, reason: string) {
  return createCoreRpcHttpError({ code, reason, status: 400 });
}
