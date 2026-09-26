import {
  REMOTE_AGENT_GIT_MAX_TREE_BYTES,
  REMOTE_AGENT_GIT_TTL_MS,
  type RemoteAgentGitCheckoutInput,
  type RemoteAgentGitPublishInput,
  type RemoteAgentGitTreeEntry,
  remoteAgentExecutionScopeKey,
  remoteAgentGitCheckoutInputSchema,
  remoteAgentGitPublishInputSchema,
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
import { requireRemoteAgentExecutionAccess } from "../agent-core/execution-access";
import { resolveGitHubActionContext } from "../agent-core/github-tools";
import { buildRemoteAgentToolContext } from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import { GitHubWorkingCopyProvider } from "../connectors/github-working-copy-provider";
import type { ConnectorExecutionConfig } from "../connectors/open-connector-runtime";
import {
  type ComputerDataSourceAccess,
  recordComputerDataSource,
} from "./computer-data-sources";
import {
  GitWorkingCopyComputer,
  type GitWorkingCopyComputerApi,
  type GitWorkingCopyLocation,
} from "./github-working-copy-computer";

export const REMOTE_AGENT_GIT_STORAGE_PREFIX = "github-working-copy:v1:";
type Dependencies = {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  connectorExecution: ConnectorExecutionConfig;
  computer: GitWorkingCopyComputerApi;
  dataSources: ComputerDataSourceAccess;
  workingDirectory: string;
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
type Publication = { signature: string; commit: string; refAttempted: boolean };

export function getGitHubWorkingCopyTools(
  input: Dependencies
): RemoteAgentToolDefinition[] {
  return [
    {
      name: "github_checkout_repository",
      description:
        "Prepare a private GitHub repository snapshot in this isolated Computer using the explicitly selected Plugin account. Use one stable key and the same owner/repo/ref/githubActor for retries. A preparing result means the next bounded batch is needed: call again with the unchanged input. Ready supplies the exact source commit/tree, directory and fixed task branch. Git history, LFS payloads and submodule repositories are not downloaded. Use the existing computer_command tools for editing, git commits and tests. Provider credentials never enter the Computer. No remote branch is created by checkout.",
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
  ];
}

async function locate(input: Dependencies, key: string) {
  const scope = await requireRemoteAgentExecutionAccess(input);
  const scopeKey = remoteAgentExecutionScopeKey(scope);
  const id = await digestCanonicalJson([scopeKey, key]);
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

function provider(input: Dependencies, record: Checkout, signal?: AbortSignal) {
  return new GitHubWorkingCopyProvider({
    runtime: input.connectorExecution,
    owner: record.intent.owner,
    repo: record.intent.repo,
    connectionName: record.connectionName,
    authorize: (effect) => authorizeCheckout(input, record, effect),
    signal,
  });
}

async function createCheckout(
  input: Dependencies,
  intent: RemoteAgentGitCheckoutInput,
  identity: Awaited<ReturnType<typeof locate>>,
  signal?: AbortSignal
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
    repositoryId: 0,
  };
  const remote = provider(input, preliminary, signal);
  const repository = await remote.repository();
  const commit = await remote.commit(intent.ref);
  const entries = await remote.tree(commit.tree.sha);
  const text = JSON.stringify(entries);
  if (Buffer.byteLength(text) > REMOTE_AGENT_GIT_MAX_TREE_BYTES) {
    throw new Error("github.checkout.manifest_too_large");
  }
  const record: Checkout = {
    ...preliminary,
    repositoryId: repository.id,
    sourceCommit: commit.sha,
    sourceTree: commit.tree.sha,
    manifestDigest: await textDigest(text),
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
  return frozen;
}

export async function checkoutRepository(
  input: Dependencies,
  intent: RemoteAgentGitCheckoutInput,
  signal?: AbortSignal
) {
  const identity = await locate(input, intent.key);
  const record =
    identity.stored ?? (await createCheckout(input, intent, identity, signal));
  if (record.signature !== (await digestCanonicalJson(intent))) {
    throw new Error(
      "github.checkout.key_conflict: This key belongs to a different checkout request."
    );
  }
  const remote = provider(input, record, signal);
  const entries = await remote.tree(record.sourceTree);
  if ((await textDigest(JSON.stringify(entries))) !== record.manifestDigest) {
    throw new Error("github.checkout.manifest_changed");
  }
  const computer = new GitWorkingCopyComputer(input.computer, signal);
  await recordComputerDataSource({
    ...input,
    source: {
      kind: "plugin_connection",
      service: "github",
      connectionName: record.connectionName,
      connectionUpdatedAtMs: record.connectionUpdatedAtMs,
    },
  });
  await computer.writeManifest(record, entries);
  let progress = await computer.prepare(record);
  const allowed = new Set(
    entries.filter((entry) => entry.type === "blob").map((entry) => entry.sha)
  );
  for (const sha of progress.missing ?? []) {
    if (!allowed.has(sha)) {
      throw new Error("github.checkout.unexpected_blob_request");
    }
    await computer.writeBlob(record, sha, await remote.blob(sha));
  }
  if (!progress.ready) {
    progress = await computer.prepare(record);
  }
  await authorizeCheckout(input, record, "read");
  return {
    status: progress.ready ? "ready" : "preparing",
    key: intent.key,
    sourceCommit: record.sourceCommit,
    sourceTree: record.sourceTree,
    branch: record.branch,
    remainingBlobs: progress.remaining,
    ...(progress.ready
      ? { directory: record.directory, localCommit: progress.localCommit }
      : {}),
    history: "snapshot_only",
    credentialsInComputer: false,
    nextAction: progress.ready
      ? "Edit, commit, and test in this directory with the existing Computer tools."
      : "Call github_checkout_repository again with identical input to transfer the next bounded batch.",
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
      request
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

async function uploadObjects(
  remote: GitHubWorkingCopyProvider,
  computer: GitWorkingCopyComputer,
  record: Checkout,
  entries: RemoteAgentGitTreeEntry[],
  tree: string,
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

async function textDigest(text: string) {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  ).toString("hex");
}
