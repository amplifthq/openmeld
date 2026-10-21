import {
  detectSpaceAttachmentMimeType,
  REMOTE_AGENT_GIT_MAX_TOTAL_BYTES,
  REMOTE_AGENT_GIT_MAX_TREE_BYTES,
  REMOTE_AGENT_GIT_TTL_MS,
  type RemoteAgentGitCheckoutInput,
  type RemoteAgentGitPublishInput,
  type RemoteAgentGitTreeEntry,
  remoteAgentExecutionScopeKey,
  remoteAgentGitCheckoutInputSchema,
  remoteAgentGitPublishInputSchema,
  remoteAgentGitShaSchema,
  remoteAgentGitTransferGrantSchema,
  remoteAgentGitTreeSchema,
} from "@openmeld/schemas";
import { digestCanonicalJson } from "@openmeld/utils";
import { picklist, strictObject, string } from "valibot";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import {
  readConnectorActionOperation,
  recordConnectorActionOperation,
} from "../agent-core/connector-tools";
import { resolveRemoteAgentRoutineExternalWriteBlock } from "../agent-core/destructive-authorization";
import {
  isDelegatedGitHubTurn,
  requireRemoteAgentExecutionAccess,
} from "../agent-core/execution-access";
import { resolveGitHubActionContext } from "../agent-core/github-tools";
import {
  buildRemoteAgentCoreContext,
  buildRemoteAgentToolContext,
} from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  GitHubWorkingCopyProvider,
  gitBlobSha,
} from "../connectors/github-working-copy-provider";
import type { ConnectorExecutionConfig } from "../connectors/open-connector-runtime";
import type { AgentComputerWorkspaceAccess } from "./agent-computer-workspace-access";
import { createAgentComputerFileHandoff } from "./computer-file-handoff";
import { createComputerGitConnectionTool } from "./computer-git-connection";
import {
  GitWorkingCopyComputer,
  type GitWorkingCopyComputerApi,
  type GitWorkingCopyLocation,
} from "./github-working-copy-computer";
import { advanceGitPackTransfer } from "./github-working-copy-transfer";
export const REMOTE_AGENT_GIT_STORAGE_PREFIX = "github-working-copy:v2:";
// Code Mode stops its script after 60 seconds. Leave time to import the blobs
// already transferred and return a truthful preparing result.
const CHECKOUT_BATCH_SOFT_BUDGET_MS = 45_000;
const CHECKOUT_BATCH_HARD_BUDGET_MS = 55_000;
const CHECKOUT_BLOB_CONCURRENCY = 4;
const CHECKOUT_PREPARE_RESERVE_MS = 10_000;
const GITHUB_REPOSITORY_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/u;
const GITHUB_OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
type Dependencies = {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  connectorExecution: ConnectorExecutionConfig;
  computer: GitWorkingCopyComputerApi;
  workingDirectory: string;
  workspaceAccess: AgentComputerWorkspaceAccess;
};
type Checkout = GitWorkingCopyLocation & {
  intent: RemoteAgentGitCheckoutInput;
  signature: string;
  scopeKey: string;
  connectionName: string;
  connectionUpdatedAtMs: number;
  repositoryId: number;
  branch: string;
  expiresAtMs: number;
};
type CheckoutTimings = {
  authorization: number;
  treeGet: number;
  blobGet: number;
  otherGet: number;
  computerWrite: number;
  computerPrepare: number;
};
type Publication = {
  signature: string;
  commit: string;
  refAttempted: boolean;
};
type FilePublication = Publication & {
  branch: string;
  path: string;
  owner: string;
  repo: string;
  githubActor: "requester" | "organization";
};
export function getGitHubWorkingCopyTools(
  input: Dependencies
): RemoteAgentToolDefinition[] {
  return [
    createComputerGitConnectionTool(input),
    {
      name: "github_checkout_repository",
      description:
        "Prepare a private GitHub snapshot for bounded API-based publication with github_publish_checkout. For an ordinary native clone, use computer_git_connection and git clone instead. Select the Plugin account explicitly. Use one stable key and the same owner/repo/ref/githubActor for retries. A preparing result requires another unchanged call. Ready supplies the source commit/tree, directory, fixed task branch and authenticated default-branch baseline at origin/<default-branch>. Local commits use a synthetic comparison graph, not upstream history. LFS payloads and submodule repositories are not downloaded. Use computer for editing, commits and tests. Provider credentials never enter the Computer. Checkout does not create a remote branch.",
      input: strictObject({
        key: string(),
        owner: string(),
        repo: string(),
        ref: string(),
        githubActor: picklist(["requester", "organization"]),
      }),
      execute: async (raw, options) =>
        await checkoutRepository(
          input,
          remoteAgentGitCheckoutInputSchema.parse(raw),
          options?.signal
        ),
    },
    {
      name: "github_publish_checkout",
      description:
        "Publish one exact local Git commit from a ready github_checkout_repository working copy to its fixed task branch. Supply the source commit as expectedRemoteHead on first publication, or the previously returned remote commit for a subsequent publication. Reuse operationId and identical inputs for retries. Completed writes are reconciled, never blindly repeated; an unknown branch-update outcome must be inspected. This does not merge, force-push, change repositories/accounts, or claim tests passed. Run tests on the exact local commit/tree first and report their evidence separately. Use the existing github_create_pull_request with draft=true and the returned branch to open a Draft PR.",
      input: strictObject({
        key: string(),
        localCommit: string(),
        expectedRemoteHead: string(),
        operationId: string(),
        message: string(),
      }),
      execute: async (raw, options) =>
        await publishCheckout(
          input,
          remoteAgentGitPublishInputSchema.parse(raw),
          options?.signal
        ),
    },
    {
      name: "github_publish_computer_file",
      description:
        "Publish one PNG or JPEG image or screenshot already downloaded into this Computer to a private GitHub repository. Supply its Computer path, owner/repo, the explicit GitHub identity and a stable operationId. This makes one file commit on an OpenMeld side branch, never main; no repository checkout or model-visible file bytes are needed. Reuse identical inputs and operationId on retries. Returns a commit-pinned GitHub blob?raw=true URL that viewers with repository access can embed in an issue or PR. Keep the side branch so GitHub retains the commit; the link is not public to people without repository access. This does not open a PR or attest tests.",
      input: strictObject({
        path: string(),
        owner: string(),
        repo: string(),
        githubActor: picklist(["requester", "organization"]),
        operationId: string(),
      }),
      execute: async (raw, options) =>
        await publishComputerFile(
          input,
          raw as PublishComputerFileInput,
          options?.signal
        ),
    },
  ];
}
type PublishComputerFileInput = {
  path: string;
  owner: string;
  repo: string;
  githubActor: "requester" | "organization";
  operationId: string;
};
export async function publishComputerFile(
  input: Dependencies,
  request: PublishComputerFileInput,
  signal?: AbortSignal
) {
  const scope = await requireRemoteAgentExecutionAccess(input);
  const scopeKey = remoteAgentExecutionScopeKey(scope);
  const toolContext = await buildRemoteAgentToolContext({
    storage: input.storage,
    submissionId: input.context.submissionId,
    toolName: "github_publish_computer_file",
  });
  const selected = await resolveGitHubActionContext({
    ...input,
    submissionId: input.context.submissionId,
    toolContext,
    githubActor: request.githubActor,
    includeAccessPolicy: true,
  });
  const connection = selected.selection.connection;
  const authorize = async (effect: "read" | "write") =>
    await requireRemoteAgentExecutionAccess({
      ...input,
      effect,
      sources: [
        {
          kind: "plugin_connection",
          connectionName: connection.connectionName,
          connectionUpdatedAtMs: connection.updatedAtMs,
          service: "github",
        },
      ],
    });
  await authorize("write");
  const block = resolveRemoteAgentRoutineExternalWriteBlock(toolContext);
  if (block) {
    return block;
  }
  if (toolContext.turnEnvelope?.trigger.source === "member_research") {
    throw new Error("github.publish.read_only_context");
  }
  if (!validComputerFilePublishRequest(request)) {
    throw new Error("github.publish.invalid_repository_or_operation");
  }
  const file = await input.workspaceAccess.withWorkspace(
    async (workspace) =>
      await createAgentComputerFileHandoff({
        workingDirectory: input.workingDirectory,
        workspace,
        maxBinaryFileBytes: 8 * 1024 * 1024,
      }).readBinaryFile(request.path)
  );
  const mime = detectSpaceAttachmentMimeType(file.bytes);
  if (!mime) {
    throw new Error(
      "github.publish.image_required: Select a PNG or JPEG file."
    );
  }
  const blob = await gitBlobSha(file.bytes);
  const signature = await digestCanonicalJson({
    request,
    scopeKey,
    connectionName: connection.connectionName,
    connectionUpdatedAtMs: connection.updatedAtMs,
    blob,
  });
  const id = await digestCanonicalJson([
    scopeKey,
    request.owner,
    request.repo,
    request.operationId,
  ]);
  const branch = `openmeld/work-${id.slice(0, 32)}`;
  const path = `openmeld/attachments/${blob}.${mime === "image/png" ? "png" : "jpg"}`;
  const stateKey = `${REMOTE_AGENT_GIT_STORAGE_PREFIX}file:${id}`;
  const remote = new GitHubWorkingCopyProvider({
    runtime: input.connectorExecution,
    owner: request.owner,
    repo: request.repo,
    connectionName: connection.connectionName,
    authorize,
    signal,
  });
  const operation = {
    actionId: "github.publish_computer_file",
    effect: "write" as const,
    service: "github" as const,
    connectionName: connection.connectionName,
    coreWorker: input.coreWorker,
    operationId: request.operationId,
    requestSignature: signature,
    toolContext,
  };
  let publication = await input.storage.get<FilePublication>(stateKey);
  if (publication && publication.signature !== signature) {
    throw new Error("github.publish.operation_conflict");
  }
  const existing = await readConnectorActionOperation(operation);
  const current = await remote.branch(branch);
  if (publication?.refAttempted) {
    if (current === publication.commit) {
      if (existing?.status !== "completed") {
        await recordConnectorActionOperation({
          ...operation,
          outcome: "completed",
          providerExecutionId: publication.commit,
        });
      }
      return computerFileReceipt(publication, request.operationId, true);
    }
    return {
      status: "outcome_unknown",
      operationId: request.operationId,
      branch,
      candidateCommit: publication.commit,
      currentHead: current,
      nextAction: "Inspect the branch; do not create another write.",
    };
  }
  if (current !== null) {
    throw new Error(
      "github.publish.branch_exists: This operation branch is already occupied."
    );
  }
  if (!publication) {
    const commit = await createComputerFileCommit({
      remote,
      operation,
      bytes: file.bytes,
      blob,
      path,
    });
    await input.storage.putIfAbsentExpiring(
      stateKey,
      {
        signature,
        commit: commit.sha,
        refAttempted: false,
        branch,
        path,
        owner: request.owner,
        repo: request.repo,
        githubActor: request.githubActor,
      } satisfies FilePublication,
      Date.now() + REMOTE_AGENT_GIT_TTL_MS
    );
    publication = await input.storage.get<FilePublication>(stateKey);
  }
  if (!publication || publication.signature !== signature) {
    throw new Error("github.publish.operation_conflict");
  }
  const attempted = { ...publication, refAttempted: true };
  if (
    !(await input.storage.compareAndSetExpiring(
      stateKey,
      publication,
      attempted,
      Date.now() + REMOTE_AGENT_GIT_TTL_MS
    ))
  ) {
    return {
      status: "pending",
      operationId: request.operationId,
      nextAction: "Retry this exact operation to reconcile the branch update.",
    };
  }
  signal?.throwIfAborted();
  await authorize("write");
  try {
    await remote.publish(branch, publication.commit, false);
    await recordConnectorActionOperation({
      ...operation,
      outcome: "completed",
      providerExecutionId: publication.commit,
    });
  } catch (error) {
    await recordConnectorActionOperation({
      ...operation,
      outcome: "outcome_unknown",
      providerExecutionId: publication.commit,
    });
    throw new Error(
      "github.publish.outcome_unknown: Retry this exact operation to reconcile the branch update.",
      { cause: error }
    );
  }
  return computerFileReceipt(publication, request.operationId, false);
}
function validComputerFilePublishRequest(request: PublishComputerFileInput) {
  return (
    GITHUB_REPOSITORY_SEGMENT_PATTERN.test(request.owner) &&
    GITHUB_REPOSITORY_SEGMENT_PATTERN.test(request.repo) &&
    GITHUB_OPERATION_ID_PATTERN.test(request.operationId)
  );
}
async function createComputerFileCommit(input: {
  remote: GitHubWorkingCopyProvider;
  operation: Omit<
    Parameters<typeof recordConnectorActionOperation>[0],
    "outcome" | "providerExecutionId"
  >;
  bytes: Uint8Array;
  blob: string;
  path: string;
}) {
  const repository = await input.remote.repository();
  const parent = await input.remote.branch(repository.default_branch);
  if (!parent) {
    throw new Error("github.publish.default_branch_unavailable");
  }
  const base = await input.remote.commit(parent);
  await recordConnectorActionOperation({
    ...input.operation,
    outcome: "attempted",
    providerExecutionId: null,
  });
  await input.remote.createBlob(input.bytes, input.blob);
  const tree = await input.remote.createSingleFileTree(
    base.tree.sha,
    input.path,
    input.blob
  );
  const commit = await input.remote.createCommit({
    tree,
    parent,
    message: `Add Space image ${input.blob.slice(0, 12)}`,
  });
  if (commit.tree.sha !== tree) {
    throw new Error("github.publish.commit_tree_mismatch");
  }
  return commit;
}
function computerFileReceipt(
  publication: FilePublication,
  operationId: string,
  replayed: boolean
) {
  const { owner, repo, branch, path, commit, githubActor } = publication;
  return {
    status: "completed",
    operationId,
    repository: `${owner}/${repo}`,
    branch,
    commit,
    path,
    githubActor,
    replayed,
    url: `https://github.com/${owner}/${repo}/blob/${commit}/${path}?raw=true`,
    visibility: "repository_members_only",
    retention:
      "Keep this side branch while the image is referenced so the commit remains reachable.",
  };
}
async function locate(input: Dependencies, key: string) {
  const scope = await requireRemoteAgentExecutionAccess(input);
  const scopeKey = remoteAgentExecutionScopeKey(scope);
  const id = await digestCanonicalJson([2, scopeKey, key]);
  const storageKey = `${REMOTE_AGENT_GIT_STORAGE_PREFIX}${id}`;
  const stored = await input.storage.get<Checkout>(storageKey);
  if (
    stored &&
    (stored.scopeKey !== scopeKey || stored.expiresAtMs <= Date.now())
  ) {
    throw new Error(
      "github.checkout.expired_or_wrong_audience: Start a new working-copy key; existing files will not be overwritten."
    );
  }
  return { stored, id, storageKey, scopeKey };
}
async function authorizeCheckout(
  input: Dependencies,
  record: Checkout,
  effect: "read" | "write"
) {
  return await requireRemoteAgentExecutionAccess({
    ...input,
    effect,
    sources: [
      {
        kind: "plugin_connection",
        connectionName: record.connectionName,
        connectionUpdatedAtMs: record.connectionUpdatedAtMs,
        service: "github",
      },
    ],
  });
}
function provider(
  input: Dependencies,
  record: Checkout,
  signal?: AbortSignal,
  onTiming?: (
    segment: "authorization" | "treeGet" | "blobGet" | "otherGet",
    durationMs: number
  ) => void,
  deadlineAtMs?: number
) {
  return new GitHubWorkingCopyProvider({
    runtime: input.connectorExecution,
    owner: record.intent.owner,
    repo: record.intent.repo,
    connectionName: record.connectionName,
    authorize: (effect) => authorizeCheckout(input, record, effect),
    signal,
    onTiming,
    deadlineAtMs,
  });
}
async function createCheckout(
  input: Dependencies,
  intent: RemoteAgentGitCheckoutInput,
  identity: Awaited<ReturnType<typeof locate>>,
  signal?: AbortSignal,
  onTiming?: (
    segment: "authorization" | "treeGet" | "blobGet" | "otherGet",
    durationMs: number
  ) => void,
  deadlineAtMs?: number
) {
  const toolContext = await buildRemoteAgentToolContext({
    storage: input.storage,
    submissionId: input.context.submissionId,
    toolName: "github_checkout_repository",
  });
  const selected = await resolveGitHubActionContext({
    ...input,
    submissionId: input.context.submissionId,
    toolContext,
    githubActor: intent.githubActor,
    includeAccessPolicy: true,
  });
  const connection = selected.selection.connection;
  const expiresAtMs = Date.now() + REMOTE_AGENT_GIT_TTL_MS;
  const preliminary = {
    intent,
    scopeKey: identity.scopeKey,
    signature: await digestCanonicalJson(intent),
    connectionName: connection.connectionName,
    connectionUpdatedAtMs: connection.updatedAtMs,
    directory: `${input.workingDirectory}/repositories/${identity.id}`,
    transportDirectory: `${input.workingDirectory}/.openmeld-git-transfer/${identity.id}`,
    branch: `openmeld/work-${identity.id.slice(0, 32)}`,
    expiresAtMs,
    sourceCommit: "",
    sourceTree: "",
    manifestDigest: "",
    baselineBranch: "",
    baselineCommit: "",
    baselineTree: "",
    baselineManifestDigest: "",
    repositoryId: 0,
  };
  const remote = provider(input, preliminary, signal, onTiming, deadlineAtMs);
  const repository = await remote.repository();
  const commit = await remote.commit(intent.ref);
  const exactCommit = remoteAgentGitShaSchema.safeParse(
    intent.ref.toLowerCase()
  );
  if (exactCommit.success && commit.sha !== exactCommit.data) {
    throw new Error(
      "github.checkout.source_commit_mismatch: GitHub returned a different commit than the requested version."
    );
  }
  // Resolve the default branch independently of model-selected ref/HEAD.
  // It is not safe to make a candidate its own trusted verification baseline.
  const baselineRef = await remote.branch(repository.default_branch);
  if (!baselineRef) {
    throw new Error(
      "github.checkout.baseline_unavailable: The exact repository default branch is unavailable."
    );
  }
  const baseline = await remote.commit(baselineRef);
  if (baseline.sha !== baselineRef) {
    throw new Error("github.checkout.baseline_changed");
  }
  const entries = await remote.tree(commit.tree.sha);
  const baselineEntries =
    baseline.tree.sha === commit.tree.sha
      ? entries
      : await remote.tree(baseline.tree.sha);
  validateCheckoutBudget(entries, baselineEntries);
  const record: Checkout = {
    ...preliminary,
    repositoryId: repository.id,
    sourceCommit: commit.sha,
    sourceTree: commit.tree.sha,
    manifestDigest: await textDigest(JSON.stringify(entries)),
    baselineBranch: repository.default_branch,
    baselineCommit: baseline.sha,
    baselineTree: baseline.tree.sha,
    baselineManifestDigest: await textDigest(JSON.stringify(baselineEntries)),
  };
  await input.storage.putIfAbsentExpiring(
    identity.storageKey,
    record,
    expiresAtMs
  );
  const frozen = await input.storage.get<Checkout>(identity.storageKey);
  if (!frozen) {
    throw new Error("github.checkout.state_unavailable");
  }
  return {
    record: frozen,
    entries: frozen.manifestDigest === record.manifestDigest ? entries : null,
    baselineEntries:
      frozen.baselineManifestDigest === record.baselineManifestDigest
        ? baselineEntries
        : null,
  };
}
async function readVerifiedCachedManifests(
  computer: GitWorkingCopyComputer,
  record: Checkout
): Promise<{
  entries: RemoteAgentGitTreeEntry[];
  baselineEntries: RemoteAgentGitTreeEntry[];
} | null> {
  try {
    const manifest = await computer.readManifest(record, "manifest.json");
    const baseline = await computer.readManifest(record, "baseline.json");
    if (
      (await textDigest(manifest)) !== record.manifestDigest ||
      (await textDigest(baseline)) !== record.baselineManifestDigest
    ) {
      return null;
    }
    return {
      entries: remoteAgentGitTreeSchema.parse({
        sha: record.sourceTree,
        truncated: false,
        tree: JSON.parse(manifest),
      }).tree,
      baselineEntries: remoteAgentGitTreeSchema.parse({
        sha: record.baselineTree,
        truncated: false,
        tree: JSON.parse(baseline),
      }).tree,
    };
  } catch {
    // A missing or altered Computer cache is rebuilt from the pinned trees.
    return null;
  }
}
async function loadVerifiedCheckoutManifests(input: {
  record: Checkout;
  created: Awaited<ReturnType<typeof createCheckout>> | null;
  cached: Awaited<ReturnType<typeof readVerifiedCachedManifests>>;
  remote: GitHubWorkingCopyProvider;
}) {
  const entries =
    input.created?.entries ??
    input.cached?.entries ??
    (await input.remote.tree(input.record.sourceTree));
  const baselineEntries =
    input.created?.baselineEntries ??
    input.cached?.baselineEntries ??
    (input.record.baselineTree === input.record.sourceTree
      ? entries
      : await input.remote.tree(input.record.baselineTree));
  validateCheckoutBudget(entries, baselineEntries);
  if (
    (await textDigest(JSON.stringify(baselineEntries))) !==
    input.record.baselineManifestDigest
  ) {
    throw new Error("github.checkout.baseline_changed");
  }
  if (
    (await textDigest(JSON.stringify(entries))) !== input.record.manifestDigest
  ) {
    throw new Error("github.checkout.manifest_changed");
  }
  return { entries, baselineEntries };
}
async function transferCheckoutBlobs(input: {
  allowed: Set<string>;
  missing: string[];
  remote: GitHubWorkingCopyProvider;
  signal?: AbortSignal;
  startedAtMs: number;
  writeBlob: (sha: string, bytes: Uint8Array) => Promise<void>;
}): Promise<void> {
  for (const sha of input.missing) {
    if (!input.allowed.has(sha)) {
      throw new Error("github.checkout.unexpected_blob_request");
    }
  }
  let nextMissingIndex = 0;
  let transferError: unknown;
  await Promise.all(
    Array.from(
      { length: Math.min(CHECKOUT_BLOB_CONCURRENCY, input.missing.length) },
      async () => {
        while (!transferError && nextMissingIndex < input.missing.length) {
          const remainingMs =
            CHECKOUT_BATCH_SOFT_BUDGET_MS - (Date.now() - input.startedAtMs);
          if (remainingMs <= CHECKOUT_PREPARE_RESERVE_MS) {
            return;
          }
          const sha = input.missing[nextMissingIndex++];
          if (!sha) {
            return;
          }
          try {
            const bytes = await input.remote.blob(
              sha,
              Math.min(20_000, remainingMs - CHECKOUT_PREPARE_RESERVE_MS)
            );
            await input.writeBlob(sha, bytes);
          } catch (error) {
            if (
              !input.signal?.aborted &&
              error instanceof Error &&
              error.name === "TimeoutError"
            ) {
              return;
            }
            transferError = error;
          }
        }
      }
    )
  );
  if (transferError) {
    throw transferError;
  }
}
async function prepareCheckoutWithinBudget(input: {
  computer: GitWorkingCopyComputer;
  record: Checkout;
  startedAtMs: number;
  final: boolean;
  measure: <T>(action: () => Promise<T>) => Promise<T>;
}) {
  const remainingMs =
    (input.final
      ? CHECKOUT_BATCH_HARD_BUDGET_MS
      : CHECKOUT_BATCH_SOFT_BUDGET_MS) -
    (Date.now() - input.startedAtMs);
  if (remainingMs <= (input.final ? 0 : CHECKOUT_PREPARE_RESERVE_MS)) {
    return null;
  }
  try {
    return await input.measure(() =>
      input.computer.prepare(
        input.record,
        remainingMs - (input.final ? 0 : CHECKOUT_PREPARE_RESERVE_MS)
      )
    );
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return null;
    }
    throw error;
  }
}
async function prepareRequesterCheckoutObjects(input: {
  dependencies: Dependencies;
  record: Checkout;
  operationId: string;
  prepareWithinBudget: (
    final: boolean
  ) => Promise<Awaited<ReturnType<GitWorkingCopyComputer["prepare"]>> | null>;
}): Promise<Awaited<ReturnType<GitWorkingCopyComputer["prepare"]>> | null> {
  const { dependencies, record, operationId, prepareWithinBudget } = input;
  const progress = await prepareWithinBudget(false);
  if (!progress || progress.ready) {
    return progress;
  }
  const start = dependencies.workspaceAccess.startGitPackTransfer;
  if (!start) {
    throw new Error("github.checkout.git_pack_host_unavailable");
  }
  const status = await start({
    operationId,
    transportDirectory: record.transportDirectory,
    sourceCommit: record.sourceCommit,
    sourceTree: record.sourceTree,
    baselineCommit: record.baselineCommit,
    baselineTree: record.baselineTree,
  });
  if (status.status === "failed") {
    throw new Error(status.errorCode ?? "github.checkout.git_transfer_failed");
  }
  if (status.status !== "available" || !status.path) {
    return progress;
  }
  const imported = await advanceGitPackTransfer({
    storage: dependencies.storage,
    workspaceAccess: dependencies.workspaceAccess,
    invocationId: dependencies.context.submissionId,
    operationId,
    location: record,
    expiresAtMs: record.expiresAtMs,
    packPath: status.path,
  });
  return imported === "completed"
    ? ((await prepareWithinBudget(true)) ?? progress)
    : progress;
}
export async function checkoutRepository(
  input: Dependencies,
  intent: RemoteAgentGitCheckoutInput,
  signal?: AbortSignal
) {
  const startedAtMs = Date.now();
  const timings: CheckoutTimings = {
    authorization: 0,
    treeGet: 0,
    blobGet: 0,
    otherGet: 0,
    computerWrite: 0,
    computerPrepare: 0,
  };
  let status: "ready" | "preparing" | "failed" = "failed";
  let remainingBlobs: number | null = null;
  try {
    const result = await checkoutRepositoryBatch(
      input,
      intent,
      signal,
      startedAtMs,
      timings
    );
    status = result.status === "ready" ? "ready" : "preparing";
    remainingBlobs = result.remainingBlobs ?? null;
    return result;
  } finally {
    console.info("[remote_agent.github_checkout.batch]", {
      status,
      remainingBlobs,
      totalMs: Date.now() - startedAtMs,
      ...timings,
    });
  }
}
async function loadOrCreateCheckout(input: {
  deps: Dependencies;
  intent: RemoteAgentGitCheckoutInput;
  signal?: AbortSignal;
  startedAtMs: number;
  timings: CheckoutTimings;
  onTiming: (
    segment: "authorization" | "treeGet" | "blobGet" | "otherGet",
    durationMs: number
  ) => void;
}) {
  const started = Date.now();
  const identity = await locate(input.deps, input.intent.key);
  input.timings.authorization += Date.now() - started;
  let created: Awaited<ReturnType<typeof createCheckout>> | null = null;
  if (!identity.stored) {
    try {
      created = await createCheckout(
        input.deps,
        input.intent,
        identity,
        input.signal,
        input.onTiming,
        input.startedAtMs + CHECKOUT_BATCH_HARD_BUDGET_MS
      );
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return null;
      }
      throw error;
    }
  }
  const record = identity.stored ?? created?.record;
  if (!record) {
    throw new Error("github.checkout.state_unavailable");
  }
  if (record.signature !== (await digestCanonicalJson(input.intent))) {
    throw new Error(
      "github.checkout.key_conflict: This key belongs to a different checkout request."
    );
  }
  return { record, created, identity };
}
async function registerRequesterCheckoutGrant(input: {
  dependencies: Dependencies;
  intent: RemoteAgentGitCheckoutInput;
  record: Checkout;
  identity: Awaited<ReturnType<typeof locate>>;
}) {
  const { dependencies, intent, record, identity } = input;
  const register = dependencies.workspaceAccess.registerGitTransferGrant;
  if (!register) {
    throw new Error("github.checkout.git_transfer_unavailable");
  }
  const toolContext = await buildRemoteAgentToolContext({
    storage: dependencies.storage,
    submissionId: dependencies.context.submissionId,
    toolName: "github_checkout_repository",
  });
  const selected = await resolveGitHubActionContext({
    ...dependencies,
    submissionId: dependencies.context.submissionId,
    toolContext,
    githubActor: "requester",
    includeAccessPolicy: true,
  });
  if (
    !selected.requesterUserId ||
    selected.selection.connection.connectionName !== record.connectionName ||
    selected.selection.connection.updatedAtMs !== record.connectionUpdatedAtMs
  ) {
    throw new Error("github.checkout.requester_connection_changed");
  }
  await register(
    remoteAgentGitTransferGrantSchema.parse({
      operationId: identity.id,
      organizationId: dependencies.context.organizationId,
      requesterUserId: selected.requesterUserId,
      owner: intent.owner,
      repo: intent.repo,
      authorization: {
        context: buildRemoteAgentCoreContext(
          dependencies.context,
          `git-transfer:${identity.id}`
        ),
        submissionId: dependencies.context.submissionId,
        ...(isDelegatedGitHubTurn(dependencies.context)
          ? { includeDelegatedRequester: true }
          : {}),
        effect: "read",
        sources: [
          {
            kind: "plugin_connection",
            service: "github",
            connectionName: record.connectionName,
            connectionUpdatedAtMs: record.connectionUpdatedAtMs,
          },
        ],
      },
      scopeKey: identity.scopeKey,
      expiresAtMs: Math.min(record.expiresAtMs, Date.now() + 30 * 60 * 1000),
    })
  );
}
async function checkoutRepositoryBatch(
  input: Dependencies,
  intent: RemoteAgentGitCheckoutInput,
  signal: AbortSignal | undefined,
  startedAtMs: number,
  timings: CheckoutTimings
) {
  const onTiming = (
    segment: "authorization" | "treeGet" | "blobGet" | "otherGet",
    durationMs: number
  ) => {
    timings[segment] += durationMs;
  };
  const measureComputer = async <T>(
    segment: "computerWrite" | "computerPrepare",
    action: () => Promise<T>
  ): Promise<T> => {
    const start = Date.now();
    try {
      return await action();
    } finally {
      timings[segment] += Date.now() - start;
    }
  };
  const loaded = await loadOrCreateCheckout({
    deps: input,
    intent,
    signal,
    startedAtMs,
    timings,
    onTiming,
  });
  if (!loaded) {
    return {
      status: "preparing" as const,
      key: intent.key,
      remainingBlobs: null,
      nextAction:
        "Repository metadata is still being prepared. Retry github_checkout_repository with identical input.",
    };
  }
  const { record, created, identity } = loaded;
  const remote = provider(
    input,
    record,
    signal,
    onTiming,
    startedAtMs + CHECKOUT_BATCH_HARD_BUDGET_MS
  );
  const computer = new GitWorkingCopyComputer(input.computer, signal);
  const prepareWithinBudget = (final: boolean) =>
    prepareCheckoutWithinBudget({
      computer,
      record,
      startedAtMs,
      final,
      measure: (action) => measureComputer("computerPrepare", action),
    });
  const cached = created
    ? null
    : await readVerifiedCachedManifests(computer, record);
  let manifests: Awaited<ReturnType<typeof loadVerifiedCheckoutManifests>>;
  try {
    manifests = await loadVerifiedCheckoutManifests({
      record,
      created,
      cached,
      remote,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        status: "preparing" as const,
        key: intent.key,
        remainingBlobs: null,
        nextAction:
          "The pinned repository tree is still being prepared. Retry github_checkout_repository with identical input.",
      };
    }
    throw error;
  }
  const { entries, baselineEntries } = manifests;
  if (intent.githubActor === "requester") {
    await registerRequesterCheckoutGrant({
      dependencies: input,
      intent,
      record,
      identity,
    });
  }
  if (!cached) {
    await measureComputer("computerWrite", () =>
      computer.writeManifest(record, entries, baselineEntries)
    );
  }
  let progress =
    intent.githubActor === "requester"
      ? await prepareRequesterCheckoutObjects({
          dependencies: input,
          record,
          operationId: identity.id,
          prepareWithinBudget,
        })
      : await prepareWithinBudget(false);
  if (intent.githubActor !== "requester") {
    const allowed = new Set(
      [...entries, ...baselineEntries]
        .filter((entry) => entry.type === "blob")
        .map((entry) => entry.sha)
    );
    await transferCheckoutBlobs({
      allowed,
      missing: progress?.missing ?? [],
      remote,
      signal,
      startedAtMs,
      writeBlob: (sha, bytes) =>
        measureComputer("computerWrite", () =>
          computer.writeBlob(record, sha, bytes)
        ),
    });
    if (!progress?.ready) {
      progress = (await prepareWithinBudget(true)) ?? progress;
    }
  }
  const authorizationStartedAtMs = Date.now();
  try {
    await authorizeCheckout(input, record, "read");
  } finally {
    timings.authorization += Date.now() - authorizationStartedAtMs;
  }
  return {
    status: progress?.ready ? "ready" : "preparing",
    key: intent.key,
    sourceCommit: record.sourceCommit,
    sourceTree: record.sourceTree,
    branch: record.branch,
    remainingBlobs: progress?.remaining ?? null,
    ...(progress?.ready
      ? { directory: record.directory, localCommit: progress.localCommit }
      : {}),
    history: "snapshot_with_verified_baseline",
    baseline: {
      branch: record.baselineBranch,
      sourceCommit: record.baselineCommit,
      tree: record.baselineTree,
      ref: `refs/remotes/origin/${record.baselineBranch}`,
      localCommit: progress?.baselineLocalCommit,
      history: "synthetic_comparison_only",
    },
    credentialsInComputer: false,
    nextAction: progress?.ready
      ? "Edit, commit, and test in this directory with the existing Computer tools."
      : "Call github_checkout_repository again with identical input to check transfer progress.",
  };
}
export async function publishCheckout(
  input: Dependencies,
  request: RemoteAgentGitPublishInput,
  signal?: AbortSignal
) {
  const identity = await locate(input, request.key);
  const record = identity.stored;
  if (!record) {
    throw new Error("github.publish.checkout_required");
  }
  await authorizeCheckout(input, record, "write");
  const remote = provider(input, record, signal);
  if ((await remote.repository()).id !== record.repositoryId) {
    throw new Error("github.publish.repository_changed");
  }
  const computer = new GitWorkingCopyComputer(input.computer, signal);
  const snapshot = await computer.snapshot(record, request.localCommit);
  if (
    !(
      snapshot.entries &&
      snapshot.tree &&
      snapshot.localCommit === request.localCommit
    )
  ) {
    throw new Error("github.publish.incomplete_snapshot");
  }
  const signature = await digestCanonicalJson({
    request,
    scopeKey: record.scopeKey,
    connectionName: record.connectionName,
    repositoryId: record.repositoryId,
    branch: record.branch,
    tree: snapshot.tree,
  });
  const toolContext = await buildRemoteAgentToolContext({
    storage: input.storage,
    submissionId: input.context.submissionId,
    toolName: "github_publish_checkout",
  });
  const operation = {
    actionId: "github.publish_working_copy",
    effect: "write" as const,
    service: "github" as const,
    connectionName: record.connectionName,
    coreWorker: input.coreWorker,
    operationId: request.operationId,
    requestSignature: signature,
    toolContext,
  };
  const stateKey = `${identity.storageKey}:publish:${request.operationId}`;
  let publication = await input.storage.get<Publication>(stateKey);
  if (publication && publication.signature !== signature) {
    throw new Error("github.publish.operation_conflict");
  }
  const existing = await readConnectorActionOperation(operation);
  const current = await remote.branch(record.branch);
  const reconciled = await reconcilePublication({
    existing,
    publication,
    current,
    operation,
    record,
    request,
    tree: snapshot.tree,
  });
  if (reconciled) {
    return reconciled;
  }
  const routineBlock = resolveRemoteAgentRoutineExternalWriteBlock(toolContext);
  if (routineBlock) {
    return routineBlock;
  }
  if (toolContext.turnEnvelope?.trigger.source === "member_research") {
    throw new Error(
      "github.publish.read_only_context: Member research cannot publish repository changes."
    );
  }
  if ((current ?? record.sourceCommit) !== request.expectedRemoteHead) {
    throw new Error(
      "github.publish.branch_changed: No force-push is permitted. Reconcile the newer branch before publishing."
    );
  }
  // Pure planning precedes the durable dispatch claim. A known local limit
  // rejection has no provider effect and must not strand a pending operation.
  const needed = publication
    ? []
    : await planUploadObjects(remote, snapshot.entries, request);
  await recordConnectorActionOperation({
    ...operation,
    outcome: "attempted",
    providerExecutionId: null,
  });
  if (!publication) {
    await uploadObjects(
      remote,
      computer,
      record,
      snapshot.entries,
      snapshot.tree,
      needed
    );
    const created = await remote.createCommit({
      tree: snapshot.tree,
      parent: request.expectedRemoteHead,
      message: request.message,
    });
    if (created.tree.sha !== snapshot.tree) {
      throw new Error("github.publish.commit_tree_mismatch");
    }
    await input.storage.putIfAbsentExpiring(
      stateKey,
      {
        signature,
        commit: created.sha,
        refAttempted: false,
      } satisfies Publication,
      record.expiresAtMs
    );
    publication = await input.storage.get<Publication>(stateKey);
  }
  if (!publication || publication.signature !== signature) {
    throw new Error("github.publish.operation_conflict");
  }
  if (publication.refAttempted) {
    return {
      status: "pending",
      operationId: request.operationId,
      nextAction:
        "Read this same operation again to reconcile the recorded branch update.",
    };
  }
  signal?.throwIfAborted();
  await authorizeCheckout(input, record, "write");
  if (
    !(await input.storage.compareAndSetExpiring(
      stateKey,
      publication,
      { ...publication, refAttempted: true },
      record.expiresAtMs
    ))
  ) {
    return {
      status: "pending",
      operationId: request.operationId,
      nextAction:
        "Another call is publishing this same operation. Read it again with identical input.",
    };
  }
  try {
    await remote.publish(record.branch, publication.commit, current !== null);
    await recordConnectorActionOperation({
      ...operation,
      outcome: "completed",
      providerExecutionId: publication.commit,
    });
  } catch (error) {
    await recordConnectorActionOperation({
      ...operation,
      outcome: "outcome_unknown",
      providerExecutionId: publication.commit,
    });
    throw new Error(
      "github.publish.outcome_unknown: The branch update needs reconciliation. Reuse this exact operationId and input; do not create another write.",
      { cause: error }
    );
  }
  return publicationReceipt(
    record,
    request,
    snapshot.tree,
    publication.commit,
    false
  );
}
async function reconcilePublication(input: {
  existing: Awaited<ReturnType<typeof readConnectorActionOperation>>;
  publication: Publication | undefined;
  current: string | null;
  operation: Omit<
    Parameters<typeof recordConnectorActionOperation>[0],
    "outcome" | "providerExecutionId"
  >;
  record: Checkout;
  request: RemoteAgentGitPublishInput;
  tree: string;
}) {
  const { publication, record, request } = input;
  if (input.existing?.status === "completed") {
    if (!publication) {
      throw new Error("github.publish.receipt_unavailable");
    }
    return publicationReceipt(
      record,
      request,
      input.tree,
      publication.commit,
      true
    );
  }
  if (!publication?.refAttempted) {
    return null;
  }
  if (input.current !== publication.commit) {
    return {
      status: "outcome_unknown",
      branch: record.branch,
      candidateCommit: publication.commit,
      currentHead: input.current,
      nextAction:
        "Inspect the branch and this operation. Do not retry the write with a new operationId.",
    };
  }
  await recordConnectorActionOperation({
    ...input.operation,
    outcome: "completed",
    providerExecutionId: publication.commit,
  });
  return publicationReceipt(
    record,
    request,
    input.tree,
    publication.commit,
    true
  );
}
async function planUploadObjects(
  remote: GitHubWorkingCopyProvider,
  entries: RemoteAgentGitTreeEntry[],
  request: RemoteAgentGitPublishInput
) {
  const base = await remote.commit(request.expectedRemoteHead);
  const original = await remote.tree(base.tree.sha);
  const existingBlobs = new Set(
    original.filter((entry) => entry.type === "blob").map((entry) => entry.sha)
  );
  const needed = [
    ...new Set(
      entries
        .filter(
          (entry) => entry.type === "blob" && !existingBlobs.has(entry.sha)
        )
        .map((entry) => entry.sha)
    ),
  ];
  if (needed.length > 200) {
    throw new Error(
      "github.publish.change_too_large: Publish at most 200 changed blobs in one operation."
    );
  }
  return needed;
}
async function uploadObjects(
  remote: GitHubWorkingCopyProvider,
  computer: GitWorkingCopyComputer,
  record: Checkout,
  entries: RemoteAgentGitTreeEntry[],
  tree: string,
  needed: string[]
) {
  for (const sha of needed) {
    await remote.createBlob(await computer.blob(record, sha), sha);
  }
  await remote.createTree(entries, tree);
}
function publicationReceipt(
  record: Checkout,
  request: RemoteAgentGitPublishInput,
  tree: string,
  commit: string,
  replayed: boolean
) {
  return {
    status: "completed",
    operationId: request.operationId,
    repository: `${record.intent.owner}/${record.intent.repo}`,
    branch: record.branch,
    commit,
    tree,
    localCommit: request.localCommit,
    githubActor: record.intent.githubActor,
    replayed,
    tests: "not_attested_by_publish",
    nextAction:
      "Use this branch with github_create_pull_request and draft=true, or update the existing Draft PR. Report tests against the exact local commit/tree separately.",
  };
}
function validateCheckoutBudget(
  entries: RemoteAgentGitTreeEntry[],
  baseline: RemoteAgentGitTreeEntry[]
) {
  for (const manifest of [entries, baseline]) {
    if (
      Buffer.byteLength(JSON.stringify(manifest)) >
      REMOTE_AGENT_GIT_MAX_TREE_BYTES
    ) {
      throw new Error("github.checkout.manifest_too_large");
    }
  }
  const sizes = new Map<string, number>();
  for (const entry of [...entries, ...baseline]) {
    if (entry.type !== "blob") {
      continue;
    }
    if (entry.size === undefined) {
      throw new Error("github.checkout.blob_size_missing");
    }
    sizes.set(entry.sha, entry.size);
  }
  if (
    [...sizes.values()].reduce((sum, size) => sum + size, 0) >
    REMOTE_AGENT_GIT_MAX_TOTAL_BYTES
  ) {
    throw new Error(
      "github.checkout.repository_too_large: Source and verified baseline together exceed the 256 MiB content budget."
    );
  }
}
async function textDigest(text: string) {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  ).toString("hex");
}
