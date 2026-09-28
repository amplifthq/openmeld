import {
  REMOTE_AGENT_GIT_MAX_BLOB_BYTES,
  REMOTE_AGENT_GIT_MAX_TOTAL_BYTES,
  REMOTE_AGENT_GIT_MAX_TREE_BYTES,
  type RemoteAgentGitTreeEntry,
  remoteAgentGitBlobSchema,
  remoteAgentGitCommitSchema,
  remoteAgentGitRefSchema,
  remoteAgentGitRepositorySchema,
  remoteAgentGitShaSchema,
  remoteAgentGitTreeSchema,
} from "@openmeld/schemas";
import type { ConnectorExecutionConfig } from "./open-connector-runtime";

const TASK_BRANCH_PATTERN = /^openmeld\/work-[a-f0-9]{32}$/u;
const TRAILING_SLASH_PATTERN = /\/+$/u;
const ERROR_CODE_PATTERN = /^[a-z_]+$/u;
type ProviderInput = {
  runtime: ConnectorExecutionConfig;
  owner: string;
  repo: string;
  connectionName: string;
  authorize: (effect: "read" | "write") => Promise<unknown>;
  signal?: AbortSignal;
  onTiming?: (
    segment: "authorization" | "treeGet" | "blobGet" | "otherGet",
    durationMs: number
  ) => void;
};

/** The caller supplies an already-authorized connection, not credentials. No
 * arbitrary endpoint, headers, or repository switch is exposed as a model tool.
 * Contract: OpenConnector c6f45596 /docs/runtime-api.md, POST /v1/proxy/:service. */
export class GitHubWorkingCopyProvider {
  private readonly root: string;
  private readonly input: ProviderInput;
  constructor(input: ProviderInput) {
    this.input = input;
    this.root = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
  }

  async repository() {
    return remoteAgentGitRepositorySchema.parse(await this.request("", "GET"));
  }

  async commit(ref: string) {
    const value = await this.request(
      `/commits/${encodeURIComponent(ref)}`,
      "GET"
    );
    const record = asRecord(value);
    const commit = asRecord(record.commit);
    return remoteAgentGitCommitSchema.parse({
      sha: record.sha,
      tree: commit.tree,
    });
  }

  async tree(sha: string): Promise<RemoteAgentGitTreeEntry[]> {
    const value = remoteAgentGitTreeSchema.parse(
      await this.request(
        `/git/trees/${remoteAgentGitShaSchema.parse(sha)}`,
        "GET",
        undefined,
        { recursive: "1" }
      )
    );
    if (value.sha !== sha || value.truncated) {
      throw new Error(
        "github.checkout.incomplete_tree: The repository tree is incomplete or exceeds this working-copy limit. No partial checkout was accepted."
      );
    }
    const paths = new Set<string>();
    let totalBytes = 0;
    for (const entry of value.tree) {
      if (paths.has(entry.path) || !validMode(entry)) {
        throw new Error("github.checkout.invalid_tree");
      }
      paths.add(entry.path);
      if (entry.type === "blob") {
        if (
          entry.size === undefined ||
          entry.size > REMOTE_AGENT_GIT_MAX_BLOB_BYTES
        ) {
          throw new Error(
            "github.checkout.file_too_large: Use a different working environment for files larger than 8 MiB."
          );
        }
        totalBytes += entry.size;
      }
    }
    if (totalBytes > REMOTE_AGENT_GIT_MAX_TOTAL_BYTES) {
      throw new Error(
        "github.checkout.repository_too_large: This working copy is limited to 256 MiB of file content."
      );
    }
    return value.tree;
  }

  async blob(sha: string, timeoutMs = 35_000): Promise<Uint8Array> {
    const blob = remoteAgentGitBlobSchema.parse(
      await this.request(
        `/git/blobs/${remoteAgentGitShaSchema.parse(sha)}`,
        "GET",
        undefined,
        undefined,
        timeoutMs
      )
    );
    const bytes = Uint8Array.from(Buffer.from(blob.content, "base64"));
    if (
      blob.sha !== sha ||
      bytes.byteLength !== blob.size ||
      (await gitBlobSha(bytes)) !== sha
    ) {
      throw new Error("github.checkout.blob_integrity_failed");
    }
    return bytes;
  }

  async createBlob(bytes: Uint8Array, expectedSha: string) {
    if (
      bytes.byteLength > REMOTE_AGENT_GIT_MAX_BLOB_BYTES ||
      (await gitBlobSha(bytes)) !== expectedSha
    ) {
      throw new Error("github.publish.blob_integrity_failed");
    }
    const response = asRecord(
      await this.request("/git/blobs", "POST", {
        content: Buffer.from(bytes).toString("base64"),
        encoding: "base64",
      })
    );
    if (response.sha !== expectedSha) {
      throw new Error("github.publish.blob_integrity_failed");
    }
  }

  async createTree(entries: RemoteAgentGitTreeEntry[], expectedSha: string) {
    // Send a complete flat tree, including gitlinks, not a truncated changes list.
    const tree = entries
      .filter((entry) => entry.type !== "tree")
      .map(({ path, mode, type, sha }) => ({ path, mode, type, sha }));
    const result = asRecord(await this.request("/git/trees", "POST", { tree }));
    if (result.sha !== expectedSha) {
      throw new Error(
        "github.publish.tree_integrity_failed: No branch was changed."
      );
    }
  }

  async createSingleFileTree(baseTree: string, path: string, blob: string) {
    const result = asRecord(
      await this.request("/git/trees", "POST", {
        base_tree: remoteAgentGitShaSchema.parse(baseTree),
        tree: [
          {
            path,
            mode: "100644",
            type: "blob",
            sha: remoteAgentGitShaSchema.parse(blob),
          },
        ],
      })
    );
    return remoteAgentGitShaSchema.parse(result.sha);
  }

  async createCommit(input: { tree: string; parent: string; message: string }) {
    return remoteAgentGitCommitSchema.parse(
      await this.request("/git/commits", "POST", {
        tree: input.tree,
        parents: [input.parent],
        message: input.message,
      })
    );
  }

  async branch(branch: string): Promise<string | null> {
    try {
      const response = remoteAgentGitRefSchema.parse(
        await this.request(
          `/git/ref/heads/${encodeURIComponent(branch)}`,
          "GET"
        )
      );
      if (response.ref !== `refs/heads/${branch}`) {
        throw new Error("github.publish.unexpected_ref");
      }
      return response.object.sha;
    } catch (error) {
      if (
        error instanceof GitHubWorkingCopyProviderError &&
        error.status === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async publish(branch: string, sha: string, existing: boolean) {
    if (
      !(branch.startsWith("openmeld/work-") && TASK_BRANCH_PATTERN.test(branch))
    ) {
      throw new Error("github.publish.task_branch_required");
    }
    await this.request(
      existing ? `/git/refs/heads/${encodeURIComponent(branch)}` : "/git/refs",
      existing ? "PATCH" : "POST",
      existing ? { sha, force: false } : { ref: `refs/heads/${branch}`, sha }
    );
  }

  private async request(
    path: string,
    method: "GET" | "POST" | "PATCH",
    body?: unknown,
    query?: Record<string, string>,
    timeoutMs = 35_000
  ): Promise<unknown> {
    this.input.signal?.throwIfAborted();
    await this.measure("authorization", () =>
      this.input.authorize(method === "GET" ? "read" : "write")
    );
    const { runtime } = this.input;
    if (!(runtime.baseUrl && runtime.runtimeToken)) {
      throw new Error(
        "github.checkout.connector_unavailable: The connection runtime is not configured."
      );
    }
    const baseUrl = runtime.baseUrl;
    const signal = this.input.signal
      ? AbortSignal.any([this.input.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    let segment: "treeGet" | "blobGet" | "otherGet" = "otherGet";
    if (path.startsWith("/git/trees/")) {
      segment = "treeGet";
    } else if (path.startsWith("/git/blobs/")) {
      segment = "blobGet";
    }
    const response = await this.measure(segment, () =>
      (runtime.fetch ?? fetch)(
        `${baseUrl.replace(TRAILING_SLASH_PATTERN, "")}/v1/openmeld/github-working-copy`,
        {
          method: "POST",
          // Workers reject redirect: "error"; use manual and fail closed below so
          // an authenticated proxy request is never followed to another origin.
          redirect: "manual",
          signal,
          headers: {
            authorization: `Bearer ${runtime.runtimeToken}`,
            "content-type": "application/json",
            "x-oo-connector-alias": this.input.connectionName,
          },
          body: JSON.stringify({
            endpoint: `${this.root}${path}`,
            method,
            ...(body === undefined ? {} : { body }),
            ...(query ? { query } : {}),
          }),
        }
      )
    );
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    ) {
      await response.body?.cancel();
      throw new GitHubWorkingCopyProviderError(
        response.status,
        `github.checkout.unexpected_redirect: The connection runtime returned HTTP ${response.status} instead of a GitHub result; the redirect was not followed.`
      );
    }
    const envelope = parseProviderEnvelope(
      await this.measure(segment, () =>
        readBounded(response, REMOTE_AGENT_GIT_MAX_TREE_BYTES * 2)
      )
    );
    const data =
      envelope.data && typeof envelope.data === "object"
        ? asRecord(envelope.data)
        : {};
    const status =
      typeof data.status === "number" ? data.status : response.status;
    if (
      !response.ok ||
      envelope.success !== true ||
      status < 200 ||
      status >= 300
    ) {
      // Do not echo provider error bodies, signed URLs, or credential details.
      const code =
        typeof envelope.errorCode === "string" &&
        ERROR_CODE_PATTERN.test(envelope.errorCode)
          ? envelope.errorCode
          : "provider_failed";
      throw new GitHubWorkingCopyProviderError(
        status,
        `github.checkout.${code}: GitHub access returned HTTP ${status}. Check the selected account's repository grant and the connection runtime's GitHub proxy permission; no other account was substituted.`
      );
    }
    await this.measure("authorization", () =>
      this.input.authorize(method === "GET" ? "read" : "write")
    );
    return data.data;
  }

  private async measure<T>(
    segment: "authorization" | "treeGet" | "blobGet" | "otherGet",
    action: () => Promise<T>
  ): Promise<T> {
    const startedAtMs = Date.now();
    try {
      return await action();
    } finally {
      this.input.onTiming?.(segment, Date.now() - startedAtMs);
    }
  }
}

export class GitHubWorkingCopyProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseProviderEnvelope(text: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    // JSON parser errors may quote response bytes. Never return those bytes
    // from this authenticated transport as a model-visible failure message.
    throw new Error("github.checkout.invalid_provider_response");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("github.checkout.invalid_provider_response");
  }
  return value as Record<string, unknown>;
}

function validMode(entry: RemoteAgentGitTreeEntry) {
  if (entry.type === "tree") {
    return entry.mode === "040000";
  }
  if (entry.type === "commit") {
    return entry.mode === "160000";
  }
  return ["100644", "100755", "120000"].includes(entry.mode);
}

export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const prefix = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const input = new Uint8Array(prefix.byteLength + bytes.byteLength);
  input.set(prefix);
  input.set(bytes, prefix.byteLength);
  return Buffer.from(await crypto.subtle.digest("SHA-1", input)).toString(
    "hex"
  );
}

async function readBounded(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("github.checkout.empty_provider_response");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("github.checkout.response_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length).toString("utf8");
}
