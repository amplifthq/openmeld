import type {
  ListSpaceTasksResponse,
  SpaceTask,
  SpaceTaskMutationReceipt,
  SpaceTaskPhase,
  SpaceTaskResponse,
} from "@openmeld/schemas/types";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";

const PHASE_ORDER: readonly SpaceTaskPhase[] = [
  "in_review",
  "in_progress",
  "to_do",
  "done",
  "canceled",
];

const PHASE_LABELS: Record<SpaceTaskPhase, string> = {
  to_do: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
};

export function formatSpaceTaskListOutput(
  response: ListSpaceTasksResponse,
  options: { json: boolean }
): string {
  if (options.json) {
    return JSON.stringify(response);
  }
  if (response.tasks.length === 0) {
    return "No Tasks in this Space.";
  }

  const lines: string[] = [];
  for (const phase of PHASE_ORDER) {
    const tasks = response.tasks.filter((task) => task.phase === phase);
    if (tasks.length === 0) {
      continue;
    }
    lines.push(`## ${PHASE_LABELS[phase]} (${tasks.length})`);
    for (const task of tasks) {
      lines.push(formatTaskListLine(task));
    }
  }
  if (response.truncated) {
    lines.push(
      "More Tasks exist than this list shows. Narrow it with --phase."
    );
  }
  return lines.join("\n");
}

export function formatSpaceTaskDetailOutput(
  response: SpaceTaskResponse,
  options: { json: boolean }
): string {
  if (options.json) {
    return JSON.stringify(response);
  }
  const { task } = response;
  const lines = [
    `# ${sanitizeTerminalDisplayText(task.title)}`,
    `Task: ${task.taskId}`,
    `Phase: ${PHASE_LABELS[task.phase]}${
      task.needsHumanDecision ? " (needs a human decision)" : ""
    }`,
    `Revision: ${task.revision}`,
    `Assignee: ${actorLabel(task.assignee)}`,
    `Reviewer: ${actorLabel(task.reviewer)}`,
    `Requested by: ${actorLabel(task.requestedBy)}`,
    `Updated: ${task.updatedAt}`,
  ];
  if (task.description) {
    lines.push(
      "## Description",
      sanitizeTerminalDisplayText(task.description, "multi-line")
    );
  }
  if (task.completionConditions.length > 0) {
    lines.push(
      "## Done when",
      ...task.completionConditions.map(
        (condition) => `- ${sanitizeTerminalDisplayText(condition)}`
      )
    );
  }
  if (task.result) {
    lines.push(
      `## Result (result revision ${task.result.resultRevision})`,
      sanitizeTerminalDisplayText(task.result.summary, "multi-line")
    );
  }
  if (task.pullRequest) {
    lines.push(
      `Pull request: ${sanitizeTerminalDisplayText(task.pullRequest.url)} @ ${task.pullRequest.headSha}`
    );
  }
  if (task.review) {
    lines.push(
      `## Review: ${
        task.review.decision === "accepted" ? "Accepted" : "Changes requested"
      }`
    );
    if (task.review.feedback) {
      lines.push(
        sanitizeTerminalDisplayText(task.review.feedback, "multi-line")
      );
    }
  }
  if (response.allowedActions && response.allowedActions.length > 0) {
    lines.push(`Allowed actions: ${response.allowedActions.join(", ")}`);
  }
  return lines.join("\n");
}

export function formatSpaceTaskReceiptOutput(
  receipt: SpaceTaskMutationReceipt,
  options: { json: boolean }
): string {
  if (options.json) {
    return JSON.stringify(receipt);
  }
  const { task } = receipt;
  return [
    receipt.applied
      ? `Task ${task.taskId} is now ${PHASE_LABELS[task.phase]}.`
      : `Task ${task.taskId} was already up to date (${PHASE_LABELS[task.phase]}).`,
    `Title: ${sanitizeTerminalDisplayText(task.title)}`,
    `Revision: ${task.revision}`,
  ].join("\n");
}

function formatTaskListLine(task: SpaceTask): string {
  const owner = task.assignee ? actorLabel(task.assignee) : "unassigned";
  const flag = task.needsHumanDecision ? " [needs a human decision]" : "";
  return `- ${task.taskId} r${task.revision} ${sanitizeTerminalDisplayText(
    task.title
  )} (${owner})${flag}`;
}

function actorLabel(actor: { profileName: string } | null): string {
  if (!actor) {
    return "-";
  }
  return sanitizeTerminalDisplayText(actor.profileName) || "-";
}
