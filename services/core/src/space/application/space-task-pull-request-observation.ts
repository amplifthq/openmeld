import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  type GitHubPullRequestHeadEvidence,
  type GitHubPullRequestIdentity,
  readGitHubPullRequestObservations,
} from "../infrastructure/postgresql/github-app-webhook-delivery-repo";
import { projectSpaceTaskGitHubPullRequestLink } from "../infrastructure/postgresql/space-task-github-pr-link-repo";
import type { SpaceTaskService } from "./space-task-service";

// GitHub's signed before -> after transitions form a walk for each timestamp.
// Intermediate commits balance. An open walk ends at its one extra arrival;
// a force-push round trip ends at the head at the start of that timestamp.
export function resolveGitHubPullRequestHead(
  heads: readonly GitHubPullRequestHeadEvidence[],
  anchorSha: string | null
): string | null {
  const first = heads[0];
  if (!first) {
    return null;
  }
  if (heads.every(({ headSha }) => headSha === first.headSha)) {
    return first.headSha;
  }

  const graph = buildHeadTransitions(heads);
  let start: string | undefined;
  let end: string | undefined;
  for (const [sha, { balance }] of graph) {
    if (balance === 0) {
      continue;
    }
    if (balance === -1 && !start) {
      start = sha;
    } else if (balance === 1 && !end) {
      end = sha;
    } else {
      return null;
    }
  }
  const root = start ?? anchorSha;
  if (!(root && graph.has(root))) {
    return null;
  }
  return isConnected(graph, root) ? (end ?? anchorSha) : null;
}

function isConnected(
  graph: ReturnType<typeof buildHeadTransitions>,
  root: string
) {
  const reachable = new Set([root]);
  for (const sha of reachable) {
    for (const neighbor of graph.get(sha)?.neighbors ?? []) {
      reachable.add(neighbor);
    }
  }
  return reachable.size === graph.size;
}

function buildHeadTransitions(heads: readonly GitHubPullRequestHeadEvidence[]) {
  const graph = new Map<string, { balance: number; neighbors: Set<string> }>();
  function vertex(sha: string) {
    let node = graph.get(sha);
    if (!node) {
      node = { balance: 0, neighbors: new Set<string>() };
      graph.set(sha, node);
    }
    return node;
  }
  for (const { headSha, beforeSha } of heads) {
    const head = vertex(headSha);
    if (beforeSha) {
      const before = vertex(beforeSha);
      before.balance--;
      head.balance++;
      before.neighbors.add(headSha);
      head.neighbors.add(beforeSha);
    }
  }
  return graph;
}

export async function reconcileSpaceTaskGitHubPullRequest(input: {
  db: PostgresDatabase;
  identity: GitHubPullRequestIdentity;
  service: Pick<SpaceTaskService, "applyGitHubPullRequestObservation">;
  taskId: string;
}): Promise<boolean> {
  const groups = await readGitHubPullRequestObservations(
    input.db,
    input.identity
  );
  const latest = Array.from(groups.keys()).at(-1);
  if (latest === undefined) {
    return false;
  }
  const heads = groups.get(latest);
  if (!heads) {
    return false;
  }
  let priorHeadSha: string | null = null;
  let evidenceCount = heads.length;
  const earlierShas = new Set<string>();
  for (const [time, group] of groups) {
    if (time === latest) {
      break;
    }
    evidenceCount += group.length;
    priorHeadSha = resolveGitHubPullRequestHead(group, priorHeadSha);
    for (const head of group) {
      earlierShas.add(head.headSha);
      if (head.beforeSha) {
        earlierShas.add(head.beforeSha);
      }
    }
  }
  const result = input.service.applyGitHubPullRequestObservation({
    observedAtMs: latest,
    heads,
    priorHeadSha,
    earlierShas,
    evidenceCount,
    identity: input.identity,
    taskId: input.taskId,
  });
  if (result.skipReason === "pending") {
    throw new Error(
      "GitHub pull request head awaits ordering evidence. Retry reconciliation."
    );
  }
  return result.updated;
}

export async function projectAndReconcileSpaceTaskPullRequest(
  input: Parameters<typeof projectSpaceTaskGitHubPullRequestLink>[0] & {
    service: Pick<SpaceTaskService, "applyGitHubPullRequestObservation">;
  }
) {
  await projectSpaceTaskGitHubPullRequestLink(input);
  return input.task.pullRequest
    ? await reconcileSpaceTaskGitHubPullRequest({
        ...input,
        taskId: input.task.taskId,
        identity: input.task.pullRequest,
      })
    : false;
}
