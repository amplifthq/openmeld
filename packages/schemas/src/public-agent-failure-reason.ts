import * as z from "zod/v4";
import {
  type AgentRecoveryActionId,
  formatAgentRecoveryActionLabel,
} from "./agent-recovery-action";
import { RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE } from "./runtime-coordinator-reason-code";
import type { AgentFailureFacts } from "./schemas/runtime/agent-failure";
import {
  type CloudComputerCleanupReport,
  REMOTE_AGENT_COMPUTER_CLEANUP_FAILED_CODE,
} from "./schemas/runtime/cloud-computer";

export const PROJECT_LOCAL_CONNECTION_FAILURE_REASON_CODES = [
  "project.local_connection.missing",
  "project.local_connection.folder_missing",
  "project.local_connection.invalid",
] as const;

export const projectLocalConnectionFailureReasonCodeSchema = z.enum(
  PROJECT_LOCAL_CONNECTION_FAILURE_REASON_CODES
);

export type ProjectLocalConnectionFailureReasonCode =
  (typeof PROJECT_LOCAL_CONNECTION_FAILURE_REASON_CODES)[number];

export const CODEX_UPGRADE_REQUIRED_REASON =
  "Codex on this computer can't use the selected model. Update Codex or choose another Codex installation, then try again.";
export const CODE_HANDOFF_RECEIVER_UNSUPPORTED_PUBLIC_COPY =
  "This handoff needs a local Codex or Claude Agent with a matching Project connection. Choose a supported Agent and send a new handoff.";
export const CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY =
  "Center Agent couldn't finish your request. Open Diagnostics in OpenMeld for details. If you can't open OpenMeld, ask the person who set it up for your team.";
export const CENTER_AGENT_EMPTY_REPLY_PUBLIC_COPY =
  "Center Agent couldn't generate a reply. Your message is saved.";
export const CENTER_AGENT_OUTPUT_LIMIT_EXCEEDED_PUBLIC_COPY =
  "Center Agent reached the model's response limit before it could reply. Completed actions were not undone. Check the results, then send a shorter follow-up asking it to continue.";
export const CENTER_AGENT_REQUEST_START_FAILED_PUBLIC_COPY =
  "Center Agent couldn't start this request. Try again. If it keeps happening, open diagnostics in OpenMeld.";
export const CENTER_AGENT_SOURCE_MESSAGE_MISSING_PUBLIC_COPY =
  "OpenMeld couldn't find the message that started this request, so Center Agent did not run. Send the request again.";
export const CENTER_AGENT_TEMPORARILY_UNAVAILABLE_PUBLIC_COPY =
  "Center Agent isn't available right now. Try again in a moment.";
export const CENTER_AGENT_ORGANIZATION_UNAVAILABLE_PUBLIC_COPY =
  "Center Agent is currently turned off for this Organization. Contact OpenMeld support. You can open diagnostics in OpenMeld to share more details.";
function formatContextCapacityFailure(agentLabel: string): string {
  return `${agentLabel} couldn't fit the task context into the selected model. Completed actions were not undone. Choose a model with more context capacity or send a shorter follow-up asking it to inspect existing results before continuing.`;
}
export const CENTER_AGENT_CONTEXT_WINDOW_EXCEEDED_PUBLIC_COPY =
  formatContextCapacityFailure("Center Agent");
export const CENTER_AGENT_REQUEST_STOPPED_PUBLIC_COPY =
  "This request was stopped.";
export const CENTER_AGENT_EXECUTION_IDENTITY_MISMATCH_PUBLIC_COPY =
  "OpenMeld stopped this request because it could not confirm that the reply came from your Center Agent. Send the request again. If it keeps happening, open diagnostics in OpenMeld.";
export const CENTER_AGENT_REPLY_PUBLICATION_FAILED_PUBLIC_COPY =
  "Center Agent finished your request, but OpenMeld could not show the reply here. Try again. If it keeps happening, open diagnostics in OpenMeld.";
export const CENTER_AGENT_TURN_TIMEOUT_PUBLIC_COPY =
  "Center Agent took too long to finish this request. Try again. If it keeps happening, open diagnostics in OpenMeld.";

/** An absent admission ACK is not proof that native execution never started. */
export function buildTaskContinuationAdmissionExhaustedPublicCopy(input: {
  agentLabel?: string;
  attempts: number;
  executionConfirmation?: AgentFailureFacts["executionConfirmation"];
  languageTag?: string;
}): string {
  const agentLabel = input.agentLabel?.trim() || "Center Agent";
  const notExecuted = input.executionConfirmation === "not_executed";
  const confirmation = {
    not_executed: [
      `${agentLabel} did not execute this continuation.`,
      `${agentLabel} 没有执行这次续跑。`,
    ],
    executed: [
      `${agentLabel} executed this continuation, but its final outcome is not confirmed.`,
      `${agentLabel} 已执行这次续跑，但最终结果尚未确认。`,
    ],
    unknown: [
      `OpenMeld could not confirm whether ${agentLabel} started this continuation. Earlier requests may have executed.`,
      `OpenMeld 仍无法确认 ${agentLabel} 是否已开始这次续跑。之前的请求可能已经执行。`,
    ],
  }[input.executionConfirmation ?? "unknown"];
  if (isChineseFailureLanguage(input.languageTag)) {
    return `自动启动重试已停止（共 ${input.attempts} 次）；不会再自动恢复。${confirmation[1]}汇总可能尚未完成；这条通知无法确认哪些子结果仍然可用。请让 Center Agent 基于已有结果重新汇总，不要重发原请求。${notExecuted ? "" : "重发原请求可能重复执行之前的操作。"}`;
  }
  return `Automatic startup retries have stopped after ${input.attempts} attempts. There will be no automatic recovery. ${confirmation[0]} The summary may be incomplete; this notice does not confirm which child results are still available. Ask Center Agent to summarize the existing results instead of resending the original request.${notExecuted ? "" : " Resending the original request may repeat earlier actions."}`;
}

export type PublicAgentFailurePresentation = {
  severity: "neutral" | "warning" | "error";
  title: string;
  body: string;
};

/** Render owner facts; never infer retry, recovery or execution from text. */
export function formatPublicAgentFailureFacts(
  facts: AgentFailureFacts,
  context: { agentLabel?: string } = {}
): PublicAgentFailurePresentation {
  if (
    facts.reasonCode === "remote_agent.execution_cancelled" ||
    facts.reasonCode === "runtime_coordinator.pre_agent_stop_requested"
  ) {
    return renderFailureFactsCopy(
      facts.languageTag,
      "neutral",
      [
        "Task stopped",
        "This task was stopped. Completed actions were not undone.",
      ],
      ["任务已停止", "这次任务已停止。已执行的操作没有撤销。"]
    );
  }
  if (facts.reasonCode === "remote_agent.requester_membership_revoked") {
    const agentLabel = context.agentLabel?.trim() || "Center Agent";
    return renderFailureFactsCopy(
      facts.languageTag,
      "warning",
      [
        "Task access could not be confirmed",
        `${resolveMappedPublicAgentFailureReason(facts.reasonCode, agentLabel)} Earlier actions may have taken effect. Check the results before repeating the work.`,
      ],
      [
        "任务访问权限未得到确认",
        `OpenMeld 无法确认发起人目前是否有权访问这个 Space，因此 ${agentLabel} 已停止。请检查发起人的 Space 成员资格，并确认之前的操作是否已经生效，再重新发起。`,
      ]
    );
  }
  if (facts.recovery.status === "recovered") {
    return renderFailureFactsCopy(
      facts.languageTag,
      "neutral",
      [
        "Result recovered",
        "The confirmed result of this task has been recovered.",
      ],
      ["结果已恢复", "这次任务的已确认结果已恢复。"]
    );
  }
  if (
    facts.retry.status === "scheduled" ||
    facts.retry.status === "in_progress" ||
    facts.recovery.status === "in_progress"
  ) {
    return renderFailureFactsCopy(
      facts.languageTag,
      "neutral",
      [
        "Recovery in progress",
        "OpenMeld is handling recovery for this task. You do not need to send another request now.",
      ],
      ["正在恢复", "OpenMeld 正在处理这次任务的恢复。现在无需重新发起。"]
    );
  }
  if (
    facts.reasonCode === "remote_agent.admission_timeout" &&
    facts.retry.status === "exhausted" &&
    facts.retry.attempt !== undefined
  ) {
    const body = buildTaskContinuationAdmissionExhaustedPublicCopy({
      agentLabel: context.agentLabel,
      attempts: facts.retry.attempt,
      executionConfirmation: facts.executionConfirmation,
      languageTag: facts.languageTag,
    });
    return renderFailureFactsCopy(
      facts.languageTag,
      "warning",
      ["Task continuation not confirmed", body],
      ["续跑未得到确认", body]
    );
  }
  if (facts.recoveryActions.includes("review_agent_permissions")) {
    return formatPermissionFailureFacts(facts);
  }
  if (
    facts.executionConfirmation === "not_executed" ||
    facts.result.status === "not_started"
  ) {
    return renderFailureFactsCopy(
      facts.languageTag,
      "warning",
      [
        "Task did not start",
        "This task did not start and will not automatically recover. Send a new request if you still need this work.",
      ],
      [
        "任务尚未开始",
        "这次任务没有开始，也不会自动恢复。如果仍需要这项工作，请重新发起。",
      ]
    );
  }
  if (facts.result.status === "unknown") {
    return formatUnconfirmedFailureFacts(facts, context.agentLabel);
  }
  return formatFinalFailureFacts(facts);
}

function formatUnconfirmedFailureFacts(
  facts: AgentFailureFacts,
  agentLabel = "Center Agent"
): PublicAgentFailurePresentation {
  const cause = resolveFailureCauseOnly(
    facts.reasonCode,
    agentLabel.trim() || "Center Agent"
  );
  const recoveryStopped = facts.retry.status === "exhausted";
  const uncertainty = `${recoveryStopped ? "Automatic startup recovery has stopped. " : ""}${facts.executionConfirmation === "executed" ? "This task ran, but OpenMeld could not confirm its final outcome." : "OpenMeld could not confirm this task's outcome."} Earlier actions may have taken effect. Check the results before sending a new request.`;
  return renderFailureFactsCopy(
    facts.languageTag,
    "warning",
    [
      "Outcome not confirmed",
      cause ? `${cause[0]} ${uncertainty}` : uncertainty,
    ],
    [
      "结果尚未确认",
      `${cause ? `${cause[1]} ` : ""}${recoveryStopped ? "自动启动恢复已停止。" : ""}${facts.executionConfirmation === "executed" ? "这次任务已经执行，但最终结果尚未确认。" : "OpenMeld 无法确认这次任务的结果。"}之前的操作可能已经生效；请先检查结果，再重新发起。`,
    ]
  );
}

/** A terminal processing failure never authorizes replay of earlier work. */
export function formatPublicInterruptedTaskFailureFacts(
  facts: AgentFailureFacts,
  context: { agentLabel?: string } = {}
): PublicAgentFailurePresentation {
  if (
    facts.reasonCode === "remote_agent.execution_cancelled" ||
    facts.reasonCode === "remote_agent.requester_membership_revoked"
  ) {
    return formatPublicAgentFailureFacts(facts, context);
  }
  const chinese = isChineseFailureLanguage(facts.languageTag);
  const agentLabel = context.agentLabel?.trim() || "Center Agent";
  const cause = resolveFailureCauseOnly(facts.reasonCode, agentLabel);
  const results = facts.completedResults ?? [];
  const canSummarize = facts.recoveryActions.includes(
    "continue_task_continuation"
  );
  const body = chinese
    ? [
        `${agentLabel} 的本次处理中断。${cause ? ` ${cause[1]}` : ""}`,
        "部分操作可能已经生效。请先检查已有结果，避免重复执行。",
        results.length ? "你仍可查看以下已发布的结果：" : "",
        ...results.map(
          (result, index) => `[查看结果 ${index + 1}](${result.url})`
        ),
        ...(canSummarize
          ? [
              "你可以请 Center Agent 继续汇总已有成果。这只生成汇总，不会继续剩余工作。",
            ]
          : []),
      ]
        .filter(Boolean)
        .join("\n")
    : [
        `${agentLabel} couldn't finish processing this request.${cause ? ` ${cause[0]}` : ""}`,
        "Some actions may have taken effect. Check existing results before repeating any action.",
        results.length ? "These published results are still available:" : "",
        ...results.map(
          (result, index) => `[View result ${index + 1}](${result.url})`
        ),
        ...(canSummarize
          ? [
              "You can ask Center Agent to summarize the existing results. This only produces a summary; it does not continue the remaining work.",
            ]
          : []),
      ]
        .filter(Boolean)
        .join("\n");
  return {
    severity: "warning",
    title: chinese ? "处理中断" : "Processing interrupted",
    body,
  };
}

function formatPermissionFailureFacts(
  facts: AgentFailureFacts
): PublicAgentFailurePresentation {
  if (facts.result.status === "not_started") {
    return renderFailureFactsCopy(
      facts.languageTag,
      "warning",
      [
        "Review task permissions",
        "OpenMeld could not start this task with the current permission settings. The task has not started. Review the Agent Profile's permission settings.",
      ],
      [
        "需要检查任务权限",
        "OpenMeld 无法在当前权限设置下启动这次任务。任务尚未开始；请检查 Agent Profile 的权限设置。",
      ]
    );
  }
  return renderFailureFactsCopy(
    facts.languageTag,
    "warning",
    [
      "Review task permissions",
      "A permission limit blocked this task. Review the Agent Profile's permission settings and check whether earlier actions ran.",
    ],
    [
      "需要检查任务权限",
      "这次任务受到权限限制。请检查 Agent Profile 的权限设置，并先确认之前的操作是否已执行。",
    ]
  );
}

function formatFinalFailureFacts(
  facts: AgentFailureFacts
): PublicAgentFailurePresentation {
  if (facts.result.status === "published") {
    return renderFailureFactsCopy(
      facts.languageTag,
      "warning",
      [
        "Result already published",
        "This task's confirmed result was already published. Review it before repeating the work.",
      ],
      [
        "结果已发布",
        "这次任务的已确认结果已经发布。请先查看结果，不要重复执行。",
      ]
    );
  }
  if (
    facts.result.status === "unavailable" &&
    facts.reasonCode === "remote_agent.empty_assistant_response"
  ) {
    return renderFailureFactsCopy(
      facts.languageTag,
      "error",
      [
        "Task result unavailable",
        "The Agent produced no reply. Earlier actions may have taken effect. Check the results before asking the Agent to do this work again.",
      ],
      [
        "任务结果不可用",
        "Agent 没有生成回复。之前的操作可能已经生效；请先检查结果，再要求 Agent 重新执行。",
      ]
    );
  }
  if (
    facts.result.status === "unavailable" &&
    facts.reasonCode === "remote_agent.turn.output_limit_exceeded"
  ) {
    return renderFailureFactsCopy(
      facts.languageTag,
      "error",
      [
        "Task result unavailable",
        "The Agent reached the model's response limit before it could reply. Completed actions were not undone. Check the results before asking the Agent to continue.",
      ],
      [
        "任务结果不可用",
        "Agent 在回复前达到模型的输出上限。已执行的操作没有撤销；请先检查结果，再要求 Agent 继续。",
      ]
    );
  }
  if (facts.stage === "publication" && facts.result.status === "retained") {
    return renderFailureFactsCopy(
      facts.languageTag,
      "error",
      [
        "Task result not published",
        facts.recoveryActions.includes("recover_result")
          ? "The task result was retained, but OpenMeld could not publish it. Recover the result instead of repeating completed work."
          : "The task result was retained, but OpenMeld could not publish it. Do not repeat completed work.",
      ],
      [
        "任务结果未能发布",
        facts.recoveryActions.includes("recover_result")
          ? "任务结果已保存，但 OpenMeld 未能发布结果。请恢复结果，不要重复执行已完成的工作。"
          : "任务结果已保存，但 OpenMeld 未能发布结果。不要重复执行已完成的工作。",
      ]
    );
  }
  if (facts.diagnosticReference) {
    return renderFailureFactsCopy(
      facts.languageTag,
      "error",
      [
        "Task did not finish",
        "This task did not deliver a completed result. Open Diagnostics for details.",
      ],
      [
        "任务未完成",
        "这次任务没有交付完成结果。请打开 Diagnostics 查看具体情况。",
      ]
    );
  }
  return renderFailureFactsCopy(
    facts.languageTag,
    "error",
    [
      "Task did not finish",
      "This task did not deliver a completed result. Check the task's results before sending a new request.",
    ],
    ["任务未完成", "这次任务没有交付完成结果。请先检查任务结果，再重新发起。"]
  );
}

/** A Routine failure uses the same owner facts, with its existing Run locator. */
export function formatPublicRoutineFailureFacts(
  facts: AgentFailureFacts,
  context: {
    agentLabel?: string;
    routineName: string;
    runId: string;
    runUrl?: string;
  }
): string {
  const presentation = formatPublicAgentFailureFacts(facts, context);
  const chinese = isChineseFailureLanguage(facts.languageTag);
  const reference = context.runUrl
    ? `\n[${chinese ? "查看 Run 详情" : "View Run details"}](${context.runUrl})`
    : "";
  return `Routine “${context.routineName}”: ${presentation.body}\nRun ID: ${context.runId}${reference}`;
}

function renderFailureFactsCopy(
  languageTag: string | undefined,
  severity: PublicAgentFailurePresentation["severity"],
  english: readonly [string, string],
  chinese: readonly [string, string]
): PublicAgentFailurePresentation {
  const [title, body] = isChineseFailureLanguage(languageTag)
    ? chinese
    : english;
  return { severity, title, body };
}

function isChineseFailureLanguage(languageTag: string | undefined): boolean {
  return languageTag?.split("-")[0]?.toLowerCase() === "zh";
}
export const REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE =
  "remote_agent.tool_result_too_large";
export const REMOTE_AGENT_TOOL_SAFETY_LIMIT_REASON_CODE =
  "remote_agent.tool_call_budget_exceeded";
export const REMOTE_AGENT_TOOL_SAFETY_LIMIT_PUBLIC_COPY =
  "This request reached the execution safety limit before it was finished. Completed actions have not been undone. Review the results and diagnostics before starting more work.";
export const REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_PUBLIC_COPY =
  "Center Agent tried to process too much data at once. Try again; it will read large files in smaller sections. If this keeps happening, open diagnostics.";
export const REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE =
  "remote_agent.conversation_history_limit_exceeded";
export const REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY =
  "Center Agent could not continue this conversation automatically. Try again or open diagnostics.";
export const REMOTE_AGENT_IMAGE_TRANSFORM_QUOTA_EXCEEDED_PUBLIC_COPY =
  "OpenMeld couldn't process the attached images because its Cloudflare Images transformation quota is exhausted. This request did not start and won't retry automatically. Contact your OpenMeld administrator to restore image processing capacity, then send a new request.";
export const REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_REASON_CODE =
  "remote_agent.work_loop_continuation_limit_exceeded";
export const REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_PUBLIC_COPY =
  "Center Agent kept working but could not finish this request within the safe execution limit. Try again or open diagnostics.";
export const ORGANIZATION_SKILL_RELEASE_UNAVAILABLE_REASON_CODE =
  "organization_skill.release_unavailable";
export const ORGANIZATION_SKILL_RELEASE_UNAVAILABLE_PUBLIC_COPY =
  "A Skill selected for this request is no longer available. Ask an Organization admin to restore it, or send a new request without that Skill.";
const EXACT_PATTERN_PREFIX = "=";
const RUNTIME_PERMISSION_DENIAL_PUBLIC_COPY =
  "The requested action was blocked by the Agent Profile’s permission settings. Review its permissions and choose a less restrictive mode only if you trust the access it grants, then wake the agent again.";
const PROVIDER_UNAVAILABLE_PUBLIC_COPY =
  "The selected model is not responding right now. Switch this agent to another model or try again later.";
const CURSOR_MODEL_INVENTORY_UNAVAILABLE_PUBLIC_COPY =
  "Cursor couldn't confirm which models are available right now. Try waking the agent again.";
const UNSUPPORTED_MODEL_PUBLIC_COPY =
  "The selected model is no longer available for this account. Choose another model in the Agent Profile, then try again.";
const UNSUPPORTED_REASONING_PUBLIC_COPY =
  "The selected model does not support that reasoning setting. Choose an offered model and reasoning setting, then wake the agent again.";
const INTERACTION_PERMISSION_REQUIRED_PUBLIC_COPY =
  "The local agent asked for permission before it could continue. OpenMeld cannot collect that permission response yet. Review the Agent Profile’s permission mode, then wake the agent again.";
const INTERACTION_QUESTION_REQUIRED_PUBLIC_COPY =
  "The local agent asked a question before it could continue. OpenMeld cannot collect that answer yet. Run the task directly in the local agent, or adjust the prompt so it can finish without asking, then wake it again.";
const INTERACTION_PLAN_REQUIRED_PUBLIC_COPY =
  "The local agent asked for plan approval before it could continue. OpenMeld cannot collect that approval yet. Run the task directly in the local agent, or use a mode that does not require plan approval, then wake it again.";
const INTERACTION_UNSUPPORTED_PUBLIC_COPY =
  "The local agent requested an interactive response that OpenMeld does not support yet. Run the task directly in the local agent, resolve the request there, then wake it again.";
const HTML_ERROR_BODY_RE = /^\s*</;

export const DISPATCH_ERROR_SUMMARY_MAX_LENGTH = 512;
const PUBLIC_FAILURE_DETAIL_CODE_RE = /^[a-z0-9._-]+$/u;
const HOSTED_CALLBACK_MAPPED_CODE_RE =
  /^(?:remote_agent\.requester_membership_revoked$|remote_agent\.provider\.(?:authentication_failed|connection_missing|rate_limited|unavailable)|auth\.|credential\.|login\.|permission\.|provider\.(?:rate_limited|rate_limit|unavailable|authentication_failed)|connection\.)/u;
const CENTER_AGENT_CALLBACK_COPY_BY_CODE: Readonly<
  Record<
    string,
    {
      message: string;
      /** Cause only: result certainty and safe next steps are rendered separately. */
      cause?: readonly [string, string];
    }
  >
> = {
  "remote_agent.empty_assistant_response": {
    message: CENTER_AGENT_EMPTY_REPLY_PUBLIC_COPY,
  },
  "remote_agent.turn.output_limit_exceeded": {
    message: CENTER_AGENT_OUTPUT_LIMIT_EXCEEDED_PUBLIC_COPY,
  },
  "remote_agent.turn.context_window_exceeded": {
    message: CENTER_AGENT_CONTEXT_WINDOW_EXCEEDED_PUBLIC_COPY,
    cause: [
      "The conversation has grown too long for this model.",
      "对话内容超过了模型一次能处理的范围。",
    ],
  },
  "remote_agent.execution_identity_mismatch": {
    message: CENTER_AGENT_EXECUTION_IDENTITY_MISMATCH_PUBLIC_COPY,
    cause: [
      "OpenMeld could not confirm the reply's Agent identity.",
      "OpenMeld 无法确认回复的 Agent 身份。",
    ],
  },
  "remote_agent.callback_publish_failed": {
    message: CENTER_AGENT_REPLY_PUBLICATION_FAILED_PUBLIC_COPY,
  },
  "remote_agent.turn.timeout": {
    message: CENTER_AGENT_TURN_TIMEOUT_PUBLIC_COPY,
  },
  [REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE]: {
    message: REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY,
  },
  [REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE]: {
    message: REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_PUBLIC_COPY,
  },
  [REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_REASON_CODE]: {
    message: REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_PUBLIC_COPY,
    cause: [
      "The Agent reached the safe execution limit before finishing.",
      "Agent 在完成任务前达到了安全执行上限。",
    ],
  },
};

/** Generic hosted-Agent failure copy that names the Agent that actually failed. */
export function buildHostedAgentRequestFailedPublicCopy(agentLabel: string) {
  const label = agentLabel.trim() || "Center Agent";
  return `${label} couldn't finish your request. Open Diagnostics in OpenMeld for details. If you can't open OpenMeld, ask the person who set it up for your team.`;
}

export function resolveCenterAgentCallbackFailureMessage(input: {
  /** Display name of the hosted Agent that failed; defaults to Center Agent. */
  agentLabel?: string;
  failureCode: string;
  failureDetail?: string | null;
  failureMessage: string;
  explanationText?: string;
  computerCleanup?: CloudComputerCleanupReport;
}): string {
  if (
    input.failureCode === REMOTE_AGENT_COMPUTER_CLEANUP_FAILED_CODE &&
    input.explanationText
  ) {
    return input.explanationText;
  }
  if (input.computerCleanup) {
    const cleanup = input.computerCleanup;
    const progress =
      input.failureCode === "remote_agent.execution_cancelled"
        ? "New work for this request was stopped."
        : `${input.agentLabel ?? "Center Agent"} could not finish this request.`;
    let state =
      "Computer cleanup has ended, but the requested work was not confirmed complete.";
    if (!cleanup.state || cleanup.state.unfinished > 0) {
      state = "Some Computer processes have not confirmed termination.";
    } else if (cleanup.state.pendingResults > 0) {
      state =
        "Computer processes have ended, but some results or file synchronization are still unconfirmed.";
    }
    return `${progress} ${state} Completed actions were not undone. Original command receipts and saved results remain available. Check those results before repeating any operation.`;
  }
  const agentLabel = input.agentLabel ?? "Center Agent";
  const requestFailed = buildHostedAgentRequestFailedPublicCopy(agentLabel);
  const mapped = resolveHostedCallbackMappedFailure(input, agentLabel);
  if (mapped) {
    return mapped;
  }
  const centerCopy =
    agentLabel === "Center Agent"
      ? CENTER_AGENT_CALLBACK_COPY_BY_CODE[input.failureCode]
      : null;
  if (centerCopy) {
    return centerCopy.message;
  }
  switch (input.failureCode) {
    case "remote_agent.empty_assistant_response":
      return `${agentLabel} couldn't generate a reply. Your message is saved.`;
    case "remote_agent.turn.output_limit_exceeded":
      return `${agentLabel} reached the model's response limit before it could reply. Completed actions were not undone. Check the results, then send a shorter follow-up asking it to continue.`;
    case "remote_agent.execution_cancelled":
      return CENTER_AGENT_REQUEST_STOPPED_PUBLIC_COPY;
    case ORGANIZATION_SKILL_RELEASE_UNAVAILABLE_REASON_CODE:
      return ORGANIZATION_SKILL_RELEASE_UNAVAILABLE_PUBLIC_COPY;
    case "remote_agent.admission_timeout":
      return `OpenMeld could not confirm whether ${agentLabel} started this request. Open Diagnostics to check its status before starting more work.`;
    case "remote_agent.turn.context_window_exceeded":
      return formatContextCapacityFailure(agentLabel);
    case "remote_agent.execution_identity_mismatch":
      return `OpenMeld stopped this request because it could not confirm that the reply came from ${agentLabel}. Open Diagnostics in OpenMeld for details.`;
    case "remote_agent.callback_publish_failed":
      return `${agentLabel} finished your request, but OpenMeld could not show the reply here. Try again. If it keeps happening, open Diagnostics in OpenMeld.`;
    case "remote_agent.turn.timeout":
      return `${agentLabel} took too long to finish this request. Try again. If it keeps happening, open Diagnostics in OpenMeld.`;
    case REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE:
      return `${agentLabel} could not continue this conversation automatically. Open Diagnostics in OpenMeld for details.`;
    case REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE:
      return `${agentLabel} tried to process too much data at once. Try again; it will read large files in smaller sections. If this keeps happening, open Diagnostics in OpenMeld.`;
    case REMOTE_AGENT_TOOL_SAFETY_LIMIT_REASON_CODE:
      return REMOTE_AGENT_TOOL_SAFETY_LIMIT_PUBLIC_COPY;
    case REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_REASON_CODE:
      return `${agentLabel} kept working but could not finish this request within the safe execution limit. Review the results and open Diagnostics in OpenMeld before starting more work.`;
    default:
      return requestFailed;
  }
}

function resolveHostedCallbackMappedFailure(
  input: { failureCode: string; failureDetail?: string | null },
  agentLabel: string
): string | null {
  const reasonCode = resolveHostedAgentCallbackFailureReasonCode(input);
  if (reasonCode !== input.failureCode) {
    return resolveMappedPublicAgentFailureReason(reasonCode, agentLabel);
  }
  return HOSTED_CALLBACK_MAPPED_CODE_RE.test(input.failureCode)
    ? resolveMappedPublicAgentFailureReason(input.failureCode, agentLabel)
    : null;
}

/** Preserve the existing allowlisted legacy reason without exposing raw detail. */
export function resolveHostedAgentCallbackFailureReasonCode(input: {
  failureCode: string;
  failureDetail?: string | null;
}): string {
  // Older workers report a broad callback code and keep the actual reason in
  // failureDetail. Only resolve a known code; never publish raw worker detail.
  const detailCode = input.failureDetail?.trim();
  if (
    input.failureCode === "remote_agent.turn_not_completed" &&
    detailCode &&
    PUBLIC_FAILURE_DETAIL_CODE_RE.test(detailCode) &&
    resolveMappedPublicAgentFailureReason(detailCode)
  ) {
    return detailCode;
  }
  return input.failureCode;
}

const DISPATCH_ERROR_REDACTION_REPLACEMENTS: readonly [RegExp, string][] = [
  [/\b(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi, "$1[redacted]"],
  [/\b((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, "$1[redacted]"],
  [
    /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*["']?)[^"',;\s}]+/gi,
    "$1[redacted]",
  ],
  [/\bopenMeldDaemon_[A-Za-z0-9._~:/+=-]+/g, "[redacted]"],
  [/\b[A-Fa-f0-9]{40,}\b/g, "[redacted]"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}/g, "[redacted]"],
];

const PUBLIC_FAILURE_CODE_CATEGORY_BY_PREFIX: ReadonlyArray<{
  category: string;
  prefixes: readonly string[];
}> = [
  {
    category: "the local agent needs an interaction",
    prefixes: ["interaction."],
  },
  {
    category: "the runtime rejected the request",
    prefixes: ["runtime."],
  },
  {
    category: "the account needs re-authentication",
    prefixes: ["auth.", "credential.", "login."],
  },
  {
    category: "the model provider had an issue",
    prefixes: [
      "cursor.plan_",
      "provider.",
      "provider_account.",
      "model.",
      "upstream_unreachable",
      "provider_unreachable",
      "provider_exit_error",
    ],
  },
  {
    category: "the computer connection had an issue",
    prefixes: [
      "daemon.",
      "service.",
      "local_service.",
      "route.",
      "background_helper.",
      "controller.",
    ],
  },
  {
    category: "OpenMeld could not route this Wake",
    prefixes: [
      "claim_eligibility.",
      "dispatch.",
      "runtime_coordinator.",
      "agent_profile_binding.",
    ],
  },
  {
    category: "the reply could not be formatted",
    prefixes: ["openmeld.space_action.", "workspace."],
  },
];

export function resolvePublicFailureCodeCategory(errorCode: string): string {
  const normalized = errorCode.toLowerCase();
  const match = PUBLIC_FAILURE_CODE_CATEGORY_BY_PREFIX.find((entry) =>
    entry.prefixes.some((prefix) => normalized.startsWith(prefix))
  );
  return match?.category ?? "the agent hit an unclassified error";
}

function normalizeDispatchErrorSummaryPart(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  let normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  for (const [pattern, replacement] of DISPATCH_ERROR_REDACTION_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function truncateDispatchErrorSummary(value: string): string {
  if (value.length <= DISPATCH_ERROR_SUMMARY_MAX_LENGTH) {
    return value;
  }
  return `${value.slice(0, DISPATCH_ERROR_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

export function sanitizeDispatchErrorSummary(
  errorMessage: string | null | undefined
): string | null {
  const normalizedInput = normalizeDispatchErrorSummaryPart(errorMessage);
  if (!normalizedInput) {
    return null;
  }

  try {
    const parsed = JSON.parse(errorMessage ?? "") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const root = parsed as Record<string, unknown>;
      const nested =
        root.error &&
        typeof root.error === "object" &&
        !Array.isArray(root.error)
          ? (root.error as Record<string, unknown>)
          : root;
      const code = normalizeDispatchErrorSummaryPart(nested.code);
      const type = normalizeDispatchErrorSummaryPart(nested.type);
      const message =
        normalizeDispatchErrorSummaryPart(nested.message) ??
        normalizeDispatchErrorSummaryPart(nested.detail) ??
        normalizeDispatchErrorSummaryPart(root.detail);
      let classification = type;
      if (code) {
        classification = type && type !== code ? `${code} (${type})` : code;
      }
      const summary = [classification, message].filter(Boolean).join(": ");
      if (summary) {
        return truncateDispatchErrorSummary(summary);
      }
      return "The provider request failed; see operator logs for details.";
    }
  } catch {
    // Plain error messages are normalized and redacted below.
  }

  if (HTML_ERROR_BODY_RE.test(errorMessage ?? "")) {
    return "The provider request failed; see operator logs for details.";
  }
  return truncateDispatchErrorSummary(normalizedInput);
}

export type PublicAgentFailureRecoveryKind =
  | "account_access"
  | "local_agent_connection"
  | "local_agent_prepare"
  | "local_service"
  | "system_retry"
  | "request_ended"
  | "unknown";

export type PublicAgentFailureRecoveryTarget =
  | "agents"
  | "computer"
  | "cursor_account"
  | "prepare_setup"
  // A chat's Session is tied to a folder that is no longer the Agent's.
  | "session_folder"
  | "working_folder";

export type PublicAgentAvailabilityCopyContext = {
  agentControllerId?: string | null;
};

export type PublicAgentAvailabilityCopy = {
  availabilityBadgeLabel?: string;
  availabilitySummary?: string;
  availabilityTooltip?: string;
  controllerInterfaceDescription?: string;
  controllerInterfaceDescriptionFallback?: string;
  manualOnlyAgentDetail?: string;
};

export type PublicAgentFailureRecovery =
  | {
      body: string;
      kind: Exclude<
        PublicAgentFailureRecoveryKind,
        "system_retry" | "request_ended"
      >;
      primaryActionId: AgentRecoveryActionId;
      primaryActionLabel: string;
      recoveryTarget: PublicAgentFailureRecoveryTarget;
    }
  | {
      body: string;
      kind: "system_retry" | "request_ended" | "unknown";
      recoveryTarget: null;
    };

type PublicAgentFailureRecoveryMappingBase = {
  availabilityBadgeLabel?: PublicAgentAvailabilityCopyValue;
  availabilitySummary?: PublicAgentAvailabilityCopyValue;
  availabilityTooltip?: PublicAgentAvailabilityCopyValue;
  body: string | ((targetName: string) => string);
  /** Known cause only; never reuse retry guidance for an uncertain outcome. */
  cause?: readonly [
    string | ((targetName: string) => string),
    string | ((targetName: string) => string),
  ];
  controllerInterfaceDescription?: PublicAgentAvailabilityCopyValue;
  controllerInterfaceDescriptionFallback?: PublicAgentAvailabilityCopyValue;
  manualOnlyAgentDetail?: PublicAgentAvailabilityCopyValue;
  mappedReasonBody?: string | ((targetName: string) => string);
  patterns: readonly string[];
  preferMappedReasonDetailPatterns?: readonly string[];
  preferMappedReasonOverDetail?: boolean;
};

type PublicAgentAvailabilityCopyValue =
  | string
  | ((context: PublicAgentAvailabilityCopyContext) => string | undefined);

const CONTROLLER_SIGN_IN_AVAILABILITY_COPY_BY_ID: Readonly<
  Record<
    string,
    {
      controllerInterfaceDescription?: string;
      summary: string;
      tooltip: string;
    }
  >
> = {
  antigravity: {
    controllerInterfaceDescription:
      "Antigravity CLI is installed, but this computer is not signed in.",
    summary:
      "Run agy in a terminal on this computer, then sign in to Antigravity.",
    tooltip:
      "Antigravity CLI is not signed in. Run agy in a terminal on this computer.",
  },
  "claude-code": {
    summary:
      "Run claude in a terminal on this computer, then sign in to Claude Code.",
    tooltip:
      "Claude Code is not signed in. Run claude in a terminal on this computer.",
  },
  codex: {
    controllerInterfaceDescription:
      "Codex CLI is installed, but this computer is not signed in to Codex.",
    summary:
      "Run codex login in a terminal on this computer to sign in to Codex.",
    tooltip:
      "Codex is not signed in. Run codex login in a terminal on this computer.",
  },
  cursor: {
    controllerInterfaceDescription:
      "Cursor CLI is installed, but this computer is not signed in to Cursor CLI.",
    summary:
      "Run cursor-agent login in a terminal on this computer to sign in to Cursor CLI.",
    tooltip:
      "Cursor CLI is not signed in. Run cursor-agent login in a terminal on this computer.",
  },
  "grok-build": {
    controllerInterfaceDescription:
      "Grok Build is installed, but this computer is not signed in to Grok.",
    summary:
      "Run grok login in a terminal on this computer to sign in to Grok.",
    tooltip:
      "Grok Build is not signed in. Run grok login in a terminal on this computer.",
  },
  openclaw: {
    summary: "Check the model provider sign-in in OpenClaw on this computer.",
    tooltip:
      "OpenClaw's model provider sign-in needs attention on this computer.",
  },
  opencode: {
    summary:
      "Run opencode auth login in a terminal on this computer to sign in to OpenCode.",
    tooltip:
      "OpenCode is not signed in. Run opencode auth login in a terminal on this computer.",
  },
};

const DEFAULT_CONTROLLER_SIGN_IN_AVAILABILITY_COPY = {
  summary: "Sign in to this local agent from a terminal on this computer.",
  tooltip: "This local agent is not signed in on this computer.",
} as const;

type PublicAgentFailureRecoveryMapping =
  | (PublicAgentFailureRecoveryMappingBase & {
      kind: Exclude<
        PublicAgentFailureRecoveryKind,
        "system_retry" | "request_ended"
      >;
      primaryActionId: AgentRecoveryActionId;
      recoveryTarget: PublicAgentFailureRecoveryTarget;
    })
  | (PublicAgentFailureRecoveryMappingBase & {
      kind: "system_retry" | "request_ended";
      recoveryTarget: null;
    });

type PublicAgentAvailabilityOnlyMapping = Omit<
  PublicAgentFailureRecoveryMappingBase,
  "body" | "mappedReasonBody"
> & {
  availabilitySummary: PublicAgentAvailabilityCopyValue;
};

const PUBLIC_AGENT_AVAILABILITY_ONLY_COPY_BY_CODE: readonly PublicAgentAvailabilityOnlyMapping[] =
  [
    {
      availabilityBadgeLabel: "Removed",
      availabilitySummary: "This agent profile no longer exists.",
      availabilityTooltip: "Agent profile deleted",
      patterns: ["=agent_profile.not_found"],
    },
    {
      availabilityBadgeLabel: "Disconnected",
      availabilitySummary:
        "Connect the Center Agent before waking it from this Space.",
      availabilityTooltip: "Disconnected",
      patterns: [
        "=center_agent.designation_required",
        "=center_agent.designation_lookup_failed",
        "=center_agent.designation_store_unavailable",
      ],
    },
    {
      availabilityBadgeLabel: "Available",
      availabilitySummary: "This Agent can answer now.",
      availabilityTooltip: "Agent available",
      patterns: ["=remote_agent.available"],
    },
    {
      availabilityBadgeLabel: "Resting",
      availabilitySummary:
        "Center Agent is resting until the next budget window.",
      availabilityTooltip: "Center Agent resting",
      patterns: ["=remote_agent.budget_resting"],
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Center Agent cannot answer right now.",
      availabilityTooltip: "Center Agent unavailable",
      patterns: ["remote_agent."],
    },
    {
      availabilityBadgeLabel: "Available",
      availabilitySummary: "Available for Wake",
      availabilityTooltip: "Available for Wake",
      patterns: ["=agent_execution.ready"],
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking this agent's Wake availability.",
      availabilityTooltip: "Checking Wake availability",
      patterns: ["=agent_execution.check_status"],
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary:
        "OpenMeld couldn't check this local agent. It will try again.",
      availabilityTooltip: "Local agent check unavailable",
      patterns: ["=controller.interface.check_failed"],
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking computer connection.",
      availabilityTooltip: "Checking computer connection",
      patterns: ["=local_service.not_checked", "=service.not_checked"],
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking this agent's Wake route.",
      availabilityTooltip: "Checking Wake route",
      patterns: ["=wake_route.registration_pending"],
    },
    {
      availabilityBadgeLabel: "Connect",
      availabilitySummary:
        "Connect a local agent before this profile can reply.",
      availabilityTooltip: "Connect local agent",
      patterns: ["=wake_route.registration_skipped"],
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary:
        "Resolve this agent's Wake route before it can reply.",
      availabilityTooltip: "Wake route unavailable",
      patterns: ["=wake_route.registration_rejected"],
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "OpenMeld couldn't check this agent's connection.",
      availabilityTooltip: "Connection check unavailable",
      patterns: ["=wake_route.registration_unavailable"],
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "This Agent's computer is offline.",
      availabilityTooltip: "Agent computer is offline",
      patterns: ["=wake_route.registration_expired"],
    },
  ];

const buildMalformedSpaceReplyCopy = (targetName: string): string =>
  `OpenMeld could not confirm a Space response from ${targetName}, even after automatic recovery.`;

const buildEmptyAgentReplyCopy = (targetName: string): string =>
  `${targetName} finished without returning any text, so OpenMeld had nothing to post. Wake ${formatObjectTargetName(targetName)} again. If this keeps happening, open diagnostics.`;

const buildMissingAgentReplyIdentityCopy = (targetName: string): string =>
  `OpenMeld received a result from ${formatObjectTargetName(targetName)}, but the result did not identify which local agent produced it. To avoid posting under the wrong agent, OpenMeld did not publish it. Open diagnostics to inspect the local agent connection.`;

const PUBLIC_FAILURE_RECOVERY_BY_CODE: readonly PublicAgentFailureRecoveryMapping[] =
  [
    {
      body: "OpenRouter could not use this workspace's API key. Check its balance and status, or replace or remove it in AI usage settings. Included credits were not used.",
      kind: "request_ended",
      patterns: ["=ai_billing.key_unavailable"],
      recoveryTarget: null,
    },
    {
      body: "This workspace doesn't have enough included AI credits left. Add an OpenRouter API key in AI usage settings, or wait for the monthly reset.",
      kind: "request_ended",
      patterns: ["=ai_usage.monthly_limit_reached"],
      recoveryTarget: null,
    },
    {
      body: "Included AI credits can't pay for this model request. Add an OpenRouter API key in AI usage settings, or choose another model.",
      kind: "request_ended",
      patterns: ["=ai_usage.credit_hold_unavailable"],
      recoveryTarget: null,
    },
    {
      body: "AI billing is temporarily unavailable. Try again later or add your own OpenRouter key in AI usage settings.",
      kind: "request_ended",
      patterns: ["=ai_billing.unavailable"],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${targetName} couldn't connect to its model provider. Ask your OpenMeld admin to check the provider connection, then wake the agent again.`,
      cause: [
        (targetName) => `${targetName} couldn't connect to its model provider.`,
        (targetName) => `${targetName} 无法连接到模型提供方。`,
      ],
      kind: "account_access",
      patterns: ["=remote_agent.provider.connection_missing"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `OpenMeld could not confirm the requester's current access to this Space, so ${targetName} stopped. Check the requester's Space membership, then wake ${targetName} again.`,
      kind: "account_access",
      patterns: ["=remote_agent.requester_membership_revoked"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) => {
        const subject = targetName === "This agent" ? "The agent" : targetName;
        const wakeTarget =
          targetName === "This agent" ? "the agent" : targetName;
        return `${subject} finished, but OpenMeld couldn't post its reply. Wake ${wakeTarget} again. If this keeps happening, open diagnostics.`;
      },
      kind: "system_retry",
      patterns: ["=runtime_coordinator.publication_retry_exhausted"],
      recoveryTarget: null,
    },
    {
      body: "OpenMeld couldn't confirm whether this Agent is working, so its working folder was not changed. Retry setup in a moment.",
      kind: "system_retry",
      patterns: ["=agent_profile.workspace_change_eligibility_unavailable"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: "This Agent's working folder cannot change while it is working. Wait for the current Wake to finish, then retry setup.",
      kind: "system_retry",
      patterns: ["=agent_profile.workspace_change_blocked_active_execution"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      // A Session keeps its folder. After the Agent's folder changed, the
      // owner continues the chat in a new Session in the current folder.
      // Read after "<Agent> couldn't reply: ", so it names no Agent.
      body: "This chat’s session works in a folder that is no longer the Agent’s working folder. Continue in a new session in the current folder; this chat’s earlier messages stay as context.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.workspace_changed"],
      primaryActionId: "continue_in_default_folder",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "session_folder",
    },
    {
      availabilityBadgeLabel: "Working folder missing",
      availabilitySummary: "Connect this Agent’s Project on its Computer.",
      availabilityTooltip: "Project folder is not connected",
      body: (targetName) =>
        `${targetName} couldn’t start because its Project isn’t connected on the computer that runs it. Connect that Project on the Agent’s computer, then try again.`,
      kind: "local_agent_prepare",
      patterns: ["=project.local_connection.missing"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "working_folder",
    },
    {
      availabilityBadgeLabel: "Working folder missing",
      availabilitySummary:
        "Reconnect this Agent’s Project folder on its Computer.",
      availabilityTooltip: "Project folder is no longer available",
      body: (targetName) =>
        `${targetName} couldn’t start because its Project folder is no longer available on the computer that runs it. Reconnect the folder in Projects, then try again.`,
      kind: "local_agent_prepare",
      patterns: ["=project.local_connection.folder_missing"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "working_folder",
    },
    {
      availabilityBadgeLabel: "Working folder needs attention",
      availabilitySummary:
        "Review this Agent’s Project connection on its Computer.",
      availabilityTooltip: "Project connection could not be used",
      body: (targetName) =>
        `${targetName} couldn’t start because its Project connection could not be used on the computer that runs it. Review that connection and its folder, then try again.`,
      kind: "local_agent_prepare",
      patterns: ["=project.local_connection.invalid"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "working_folder",
    },
    {
      body: "OpenMeld ran into a system problem before this Wake could run. Try again. If it keeps happening, open diagnostics.",
      kind: "system_retry",
      patterns: [
        "=dispatch.storage.schema_missing",
        "dispatch.storage_not_ready",
        "dispatch.storage_unavailable",
      ],
      recoveryTarget: null,
    },
    {
      body: REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_PUBLIC_COPY,
      kind: "system_retry",
      patterns: [`=${REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE}`],
      recoveryTarget: null,
    },
    {
      body: REMOTE_AGENT_TOOL_SAFETY_LIMIT_PUBLIC_COPY,
      kind: "system_retry",
      patterns: [`=${REMOTE_AGENT_TOOL_SAFETY_LIMIT_REASON_CODE}`],
      recoveryTarget: null,
    },
    {
      body: REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY,
      kind: "system_retry",
      patterns: [
        `=${REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE}`,
      ],
      recoveryTarget: null,
    },
    {
      body: REMOTE_AGENT_IMAGE_TRANSFORM_QUOTA_EXCEEDED_PUBLIC_COPY,
      kind: "request_ended",
      patterns: ["=remote_agent.image_transform_quota_exceeded"],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Sign-in needed",
      availabilitySummary: (context) =>
        resolveControllerSignInAvailabilityCopy(context).summary,
      availabilityTooltip: (context) =>
        resolveControllerSignInAvailabilityCopy(context).tooltip,
      body: (targetName) =>
        `${targetName}'s local provider login expired on its computer. Re-authenticate the local agent there (its own CLI, not OpenMeld), then check its status here.`,
      controllerInterfaceDescription: (context) =>
        resolveControllerSignInAvailabilityCopy(context)
          .controllerInterfaceDescription,
      controllerInterfaceDescriptionFallback:
        "Installed, but this controller is not signed in.",
      kind: "local_service",
      mappedReasonBody:
        "The model provider rejected this request because the local provider login expired. Re-authenticate the local agent on its computer, then wake the agent again.",
      cause: [
        "The model provider rejected the local agent's sign-in.",
        "模型提供方拒绝了本地 Agent 的登录凭据。",
      ],
      patterns: [
        "=controller.auth.unauthenticated",
        "auth.",
        "auth.required",
        "credential.",
        "login.",
      ],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "computer",
    },
    {
      body: (targetName) =>
        `${targetName}'s selected model is not available for this agent's account. Switch it to a different model, then wake the agent again.`,
      kind: "account_access",
      mappedReasonBody: UNSUPPORTED_MODEL_PUBLIC_COPY,
      patterns: ["model.unsupported", "unsupported_model"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: RUNTIME_PERMISSION_DENIAL_PUBLIC_COPY,
      kind: "account_access",
      mappedReasonBody: RUNTIME_PERMISSION_DENIAL_PUBLIC_COPY,
      cause: [
        "The Agent Profile's permission settings blocked an action.",
        "Agent Profile 的权限设置阻止了一项操作。",
      ],
      patterns: ["permission.denied.runtime"],
      primaryActionId: "review_agent_permissions",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `${targetName} stopped this Wake because the current Cursor plan has reached its usage limit. Upgrade the Cursor plan, then wake ${targetName} again.`,
      kind: "account_access",
      mappedReasonBody: (targetName) =>
        `${targetName} stopped this Wake because the current Cursor plan has reached its usage limit. Upgrade the Cursor plan, then wake ${targetName} again.`,
      patterns: ["=cursor.plan_upgrade_required"],
      primaryActionId: "manage_cursor_plan",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "cursor_account",
    },
    {
      body: (targetName) =>
        `${targetName}'s AI account reached its Usage Limit. Review Usage Limits in agent settings before waking it again.`,
      kind: "account_access",
      mappedReasonBody: (targetName) =>
        `${targetName}'s AI account reached its Usage Limit. Review Usage Limits in agent settings before waking it again.`,
      availabilityBadgeLabel: "Usage Limit reached",
      availabilitySummary:
        "This agent's AI account reached its Usage Limit. Review Usage Limits in agent settings before waking it again.",
      availabilityTooltip: "Usage Limit reached. Review Usage Limits.",
      patterns: ["=usage_exhausted"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `OpenMeld is still checking ${targetName}'s current Usage. Wait a moment, then wake ${targetName} again.`,
      kind: "system_retry",
      mappedReasonBody:
        "OpenMeld is still checking this agent's current Usage. Wait a moment, then wake it again.",
      patterns: ["=usage_checking"],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${targetName}'s model provider account does not have enough credits for this Wake. Add credits or update billing directly with the provider, then wake the agent again.`,
      kind: "system_retry",
      mappedReasonBody:
        "The model provider rejected this request because the provider account does not have enough credits. Add credits or update billing directly with the provider, then wake the agent again.",
      patterns: [
        "provider.insufficient_balance",
        "quota.exceeded",
        "insufficient_quota",
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${targetName} hit a provider rate limit before this Wake could reply. Wait a moment, then wake the agent again.`,
      kind: "system_retry",
      mappedReasonBody:
        "The model provider rate-limited this request. Wait a moment, then wake the agent again.",
      cause: [
        "The model provider rate-limited this request.",
        "模型提供方限制了这次请求的频率。",
      ],
      patterns: [
        "provider.rate_limited",
        "provider.rate_limit",
        "rate_limited",
        "rate_limit",
      ],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary:
        "This model is no longer offered. Change this agent's model to continue.",
      availabilityTooltip: "Model no longer offered",
      body: (targetName) =>
        `${targetName}'s model is no longer offered. Change its model to continue.`,
      kind: "account_access",
      mappedReasonBody:
        "This model is no longer offered. Change this agent's model to continue.",
      patterns: ["=model.retired"],
      primaryActionId: "change_model",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary:
        "This model is unavailable. Check this agent's model settings.",
      availabilityTooltip: "Model unavailable",
      body: (targetName) =>
        `${targetName}'s model is unavailable. Check its model and account settings.`,
      kind: "account_access",
      mappedReasonBody:
        "This model is unavailable. Check this agent's model and account settings.",
      patterns: ["=model.unavailable"],
      primaryActionId: "change_model",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `${targetName}'s provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again.`,
      kind: "account_access",
      mappedReasonBody: (targetName) =>
        `${targetName}'s provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again.`,
      patterns: ["provider.subscription_access_unavailable"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `${targetName}'s selected model is not responding right now. Switch this agent to another model or try again later.`,
      kind: "account_access",
      mappedReasonBody: PROVIDER_UNAVAILABLE_PUBLIC_COPY,
      cause: [
        "The selected model is not responding right now.",
        "所选模型目前没有响应。",
      ],
      patterns: [
        "provider.unavailable",
        "provider.bad_gateway",
        "model.provider_unavailable",
      ],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Fix provider access before this agent can reply.",
      availabilityTooltip: "Provider access needed",
      body: (targetName) =>
        `${targetName} is connected, but its provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again.`,
      kind: "account_access",
      patterns: ["=provider_account.subscription_access_unavailable"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Fix provider access before this agent can reply.",
      availabilityTooltip: "Provider access needed",
      body: (targetName) =>
        `${targetName} is connected, but its organization has disabled the provider access this agent needs. Ask the provider account admin to enable access before waking it again.`,
      kind: "account_access",
      patterns: ["=provider_account.organization_access_disabled"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Review the provider plan, billing, or credits.",
      availabilityTooltip: "Provider quota exhausted",
      body: (targetName) =>
        `${targetName} is connected, but its provider quota or credit balance is exhausted. Review the provider plan, billing, or credits before waking it again.`,
      kind: "account_access",
      patterns: ["=provider_account.capacity_exhausted"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Fix provider access before this agent can reply.",
      availabilityTooltip: "Provider access needed",
      body: (targetName) =>
        `${targetName}'s provider account needs attention on its computer. Fix access with the provider there, then check its status here.`,
      kind: "account_access",
      patterns: ["provider_account."],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary:
        "This agent shares a reply conversation with another Agent Profile.",
      availabilityTooltip: "Duplicate reply conversation",
      body: (targetName) =>
        `${targetName} shares a reply conversation with another Agent Profile. Review agent settings and choose one Agent Profile to keep this reply conversation.`,
      kind: "local_agent_connection",
      patterns: ["=agent_profile_binding.controller_conversation_conflict"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary:
        "This agent cannot reply from this computer right now.",
      availabilityTooltip: "Unavailable for Wake",
      body: (targetName) =>
        `${targetName} is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again.`,
      kind: "system_retry",
      patterns: [
        "agent_profile_binding.owner_mismatch",
        "claim_eligibility.binding_owner_mismatch",
        "claim_eligibility.owner_mismatch",
        "dispatch.claim_eligibility.binding.owner_mismatch",
      ],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Workspace unavailable",
      availabilitySummary:
        "OpenMeld could not verify this Agent Profile's workspace.",
      availabilityTooltip:
        "OpenMeld could not verify this Agent Profile's workspace",
      body: (targetName) =>
        `OpenMeld could not verify ${targetName}'s workspace. Try again, and open diagnostics if the problem continues.`,
      kind: "system_retry",
      patterns: [
        "=organization_binding_authorization.lookup_failed",
        "=organization_binding_authorization.preference_unavailable",
        "=organization_binding_authorization.space_org_unavailable",
      ],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Wrong workspace",
      availabilitySummary:
        "This Agent Profile belongs to a different workspace.",
      availabilityTooltip: "This Agent Profile belongs to another workspace",
      body: (targetName) =>
        `${targetName} belongs to a different workspace. Choose an Agent Profile created in this workspace.`,
      kind: "system_retry",
      patterns: ["=agent_profile.organization_mismatch"],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Workspace unavailable",
      availabilitySummary:
        "OpenMeld could not verify this Agent Profile's workspace.",
      availabilityTooltip:
        "OpenMeld could not verify this Agent Profile's workspace",
      body: (targetName) =>
        `OpenMeld could not verify ${targetName}'s workspace. Try again, and open diagnostics if the problem continues.`,
      kind: "system_retry",
      patterns: [
        "=agent_profile.organization_context_missing",
        "=agent_profile.organization_lookup_failed",
        "=agent_profile.space_organization_unavailable",
      ],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Wrong workspace",
      availabilitySummary:
        "This Agent Profile cannot be used in this workspace.",
      availabilityTooltip: "This Agent Profile cannot be used here",
      // Old Core deployments can still emit this family during a rolling
      // upgrade. Keep it safe and non-actionable without reviving the retired
      // authorization product surface.
      body: (targetName) =>
        `${targetName} cannot be used in this workspace. Choose an Agent Profile created here.`,
      kind: "system_retry",
      patterns: [
        "=organization_binding_authorization.required",
        "=organization_binding_authorization.binding_required",
        "=organization_binding_authorization.no_bindings",
        "=organization_binding_authorization.profile_org_mismatch",
        "=organization_binding_authorization.profile_owner_mismatch",
      ],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Connection mismatch",
      availabilitySummary:
        "This Agent's saved connection does not match this computer setup. To use this setup, create a new Agent. The existing Agent has not been moved.",
      availabilityTooltip: "Agent connection does not match this setup",
      body: (targetName) =>
        `${targetName}'s saved connection does not match this computer setup. To use this setup, create a new Agent. The existing Agent has not been moved.`,
      kind: "system_retry",
      patterns: [
        "claim_eligibility.binding_runtime_mismatch",
        "claim_eligibility.openmeld_service_runtime_id_mismatch",
        "claim_eligibility.binding_capability_mismatch",
        "=local_service.identity_mismatch",
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `OpenMeld could not confirm ${targetName}'s current local agent setup. Check its status on the computer that runs it, then try again.`,
      kind: "local_agent_prepare",
      patterns: [
        "claim_eligibility.openmeld_service_runtime_id_missing",
        "claim_eligibility.openmeld_service_runtime_id_not_opaque",
        "claim_eligibility.openmeld_service_runtime_identity_invalid",
        "claim_eligibility.runtime_missing",
        "claim_eligibility.runtime_unavailable",
        "claim_eligibility.agent_controller_report_unknown",
        "claim_eligibility.agent_controller_report_missing",
        "claim_eligibility.agent_controller_report_stale",
        "claim_eligibility.agent_controller_report_disabled",
        "claim_eligibility.agent_controller_report_unavailable",
      ],
      primaryActionId: "check_status",
      recoveryTarget: "computer",
    },
    {
      availabilityBadgeLabel: "Needs attention",
      availabilitySummary:
        "Check the local agent's status on the computer that runs it.",
      availabilityTooltip: "Local agent report unavailable",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld has no current local agent report from its computer. Check the local agent’s status on that computer.`,
      kind: "local_agent_prepare",
      patterns: ["=agent_profile_binding.agent_controller_report_missing"],
      primaryActionId: "check_status",
      recoveryTarget: "computer",
    },
    {
      availabilityBadgeLabel: "Needs attention",
      availabilitySummary:
        "Check the local agent's status on the computer that runs it.",
      availabilityTooltip: "Local agent report out of date",
      body: (targetName) =>
        `${targetName} is connected, but its local agent report is out of date. Check the local agent’s status on that computer.`,
      kind: "local_agent_prepare",
      patterns: ["=agent_profile_binding.agent_controller_report_stale"],
      primaryActionId: "check_status",
      recoveryTarget: "computer",
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking this agent's local controller.",
      availabilityTooltip: "Checking local agent",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld has no current local agent report from its computer. Check the local agent’s status on that computer.`,
      kind: "local_agent_prepare",
      patterns: [
        "=runtime.projection_missing",
        "=runtime.agent_controller_report_missing",
      ],
      primaryActionId: "check_status",
      recoveryTarget: "computer",
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking this agent's local controller.",
      availabilityTooltip: "Checking local agent",
      body: (targetName) =>
        `${targetName} is connected, but its local agent report is out of date. Check the local agent’s status on that computer.`,
      kind: "local_agent_prepare",
      patterns: ["=runtime.agent_controller_report_stale"],
      primaryActionId: "check_status",
      recoveryTarget: "computer",
    },
    {
      availabilityBadgeLabel: "Connect",
      availabilitySummary:
        "Connect a local agent before this profile can reply.",
      availabilityTooltip: "Connect local agent",
      body: (targetName) =>
        `${targetName} is in this space, but OpenMeld cannot tell which local agent should reply for it yet.`,
      kind: "local_agent_connection",
      mappedReasonBody: (targetName) =>
        `No local agent has been selected to reply for ${formatObjectTargetName(targetName)} yet.`,
      patterns: [
        "agent_profile_binding.missing",
        "agent_profile_binding.disabled",
        "claim_eligibility.binding_missing",
        "claim_eligibility.binding_disabled",
        "claim_eligibility.binding_not_routable",
        "dispatch.claim_eligibility.blocked",
        "dispatch.claim_eligibility.binding.disabled_historical",
        "dispatch.claim_eligibility.binding.enabled_primary",
        "dispatch.claim_eligibility.binding.missing",
        "profile.unbound",
      ],
      manualOnlyAgentDetail: "No local agent selected for Wake",
      primaryActionId: "choose_local_agent",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `${targetName} has a conflicting reply connection. Wait a moment, then run setup again if the issue continues.`,
      kind: "local_agent_prepare",
      patterns: [
        "claim_eligibility.binding_conflict",
        "claim_eligibility.lease_conflict",
        "claim_eligibility.runtime_conflict",
        "dispatch.claim_eligibility.binding.conflict",
      ],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "OpenMeld could not verify permission to run this agent. Sign in again, then try once more.",
      kind: "system_retry",
      patterns: [
        "claim_eligibility.caller_not_allowed",
        "claim_eligibility.not_read_after_caller_authorization_failed",
      ],
      recoveryTarget: null,
    },
    {
      body: "This Wake request is no longer active. Send a new message and wake the agent again.",
      kind: "system_retry",
      patterns: [
        "claim_eligibility.non_wake_relation_not_dispatchable",
        "claim_eligibility.dispatch_evidence_missing",
        "claim_eligibility.dispatch_evidence_stale",
        "claim_eligibility.dispatch_missing",
        "claim_eligibility.dispatch_terminal",
        "claim_eligibility.wake_not_allowed_at_creation",
        "claim_eligibility.wake_no_longer_allowed_by_policy",
        "claim_eligibility.space_liveness_missing",
        "claim_eligibility.space_liveness_stale",
        "claim_eligibility.policy_version_mismatch",
      ],
      recoveryTarget: null,
    },
    {
      body: "This agent is no longer a member of this space. Add it back from the space's members panel, then try again.",
      kind: "system_retry",
      patterns: [
        "claim_eligibility.target_no_longer_member",
        "claim_eligibility.target_not_claimable_agent_member",
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `OpenMeld stopped this Wake for ${formatObjectTargetName(targetName)} because the Wake details changed after it was accepted. Send the request again. If this keeps happening, open Diagnostics.`,
      kind: "system_retry",
      patterns: [
        `=${RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE}`,
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `This Wake expired before it reached ${formatObjectTargetName(targetName)}. Reconnect the computer, then wake the Agent again.`,
      kind: "local_service",
      patterns: ["runtime_coordinator.delivery_expired"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `OpenMeld could not start ${formatObjectTargetName(targetName)} in time. Reconnect the computer, then wake the Agent again.`,
      kind: "local_service",
      patterns: ["daemon.delivery.start_timeout", "delivery.start_timeout"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "OpenMeld could not resume the Agent's conversation in time. Try waking the Agent again. If this keeps happening, open Diagnostics.",
      kind: "system_retry",
      patterns: ["=context.resume_timeout"],
      recoveryTarget: null,
    },
    {
      body: "OpenMeld could not read the latest Space messages to finish this reply. Open Diagnostics for details before trying again.",
      kind: "system_retry",
      patterns: [
        "=dispatch.agent_reply_observation.unavailable",
        "=dispatch.agent_reply_observation.no_progress",
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `OpenMeld Service stopped or disconnected while ${formatObjectTargetName(targetName)} was working on this Wake. Start OpenMeld again before retrying.`,
      kind: "local_service",
      patterns: ["=runtime.local_runtime_lost"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `${targetName} stopped making progress on this Wake. Reconnect the computer before trying again.`,
      kind: "local_service",
      patterns: ["daemon.delivery.execution_stalled", "runtime.progress_stale"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `OpenMeld received progress from ${formatObjectTargetName(targetName)}, but could not finish the final result in time.`,
      kind: "local_service",
      patterns: [
        "daemon.delivery.finalization_timeout",
        "delivery.result_timeout",
      ],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `${targetName} took too long to finish this Wake. Reconnect the computer before trying again.`,
      kind: "local_service",
      patterns: [
        "daemon.delivery.timeout",
        "local_adapter.timeout",
        "timed_out_after_output",
        "timed_out_no_output",
        "=timeout",
      ],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "Connect your computer before this Agent can reply.",
      availabilityTooltip: "Computer not connected",
      body: (targetName) =>
        `${targetName}'s computer is disconnected from OpenMeld. Reconnect the computer so it can receive local Wake work.`,
      kind: "local_service",
      patterns: ["=service.not_running"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "Connect your computer before this Agent can reply.",
      availabilityTooltip: "Computer not connected",
      body: (targetName) =>
        `OpenMeld is not set up on ${formatPossessiveTargetName(targetName)} computer. Connect the computer so it can receive local Wake work.`,
      kind: "local_service",
      patterns: ["=service.not_installed"],
      primaryActionId: "connect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Needs attention",
      availabilitySummary:
        "OpenMeld found a service problem on this computer. Open Computer details to check it.",
      availabilityTooltip: "Check OpenMeld on Computer",
      body: (targetName) =>
        `OpenMeld found a service problem on ${formatPossessiveTargetName(targetName)} computer. Open Computer details to see what needs attention.`,
      kind: "local_service",
      patterns: ["=service.drifted"],
      primaryActionId: "check_status",
      recoveryTarget: "computer",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "Connect your computer before this Agent can reply.",
      availabilityTooltip: "Computer not connected",
      body: (targetName) =>
        `${targetName}'s computer is not connected to the current OpenMeld account. Reconnect the computer.`,
      kind: "local_service",
      patterns: ["=local_service.not_connected_for_account"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "Connect your computer before this Agent can reply.",
      availabilityTooltip: "Computer not connected",
      body: (targetName) =>
        `OpenMeld could not check ${formatPossessiveTargetName(targetName)} computer connection. Reconnect the computer and try again.`,
      kind: "local_service",
      patterns: ["=local_service.unavailable"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary:
        "This computer is connected but isn't accepting new tasks yet.",
      availabilityTooltip: "Checking task availability",
      body: (targetName) =>
        `${formatPossessiveTargetName(targetName)} computer is connected but isn't accepting new tasks right now. Open Computer details to check its status.`,
      kind: "local_service",
      patterns: ["=local_service.not_accepting_wakes"],
      primaryActionId: "check_status",
      recoveryTarget: "computer",
    },
    {
      availabilityBadgeLabel: "Reconnecting",
      availabilitySummary: "Computer is reconnecting.",
      availabilityTooltip: "Reconnecting Computer",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.`,
      kind: "local_service",
      patterns: ["=local_service.reconnecting"],
      primaryActionId: "check_status",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking this agent's Wake route.",
      availabilityTooltip: "Checking Wake route",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.`,
      kind: "local_service",
      patterns: ["=agent_execution.route_missing", "=route.not_registered"],
      primaryActionId: "check_status",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "This Agent's computer is offline.",
      availabilityTooltip: "Agent computer is offline",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.`,
      kind: "local_service",
      patterns: ["=agent_execution.route_offline", "=route.offline"],
      primaryActionId: "check_status",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "OpenMeld couldn't check this agent's connection.",
      availabilityTooltip: "Connection check unavailable",
      body: (targetName) =>
        `OpenMeld couldn't check ${targetName}'s connection. Try again.`,
      kind: "local_service",
      patterns: ["=agent_execution.route_unavailable", "=route.unavailable"],
      primaryActionId: "check_status",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Update",
      availabilitySummary:
        "Update OpenMeld on your computer before this Agent can reply.",
      availabilityTooltip: "Update OpenMeld on Computer",
      body: "Update OpenMeld on this computer before it can receive local Wake work.",
      kind: "local_service",
      patterns: [
        "background_helper.installed_outdated",
        "background_helper.update_required",
        "service.update_required",
      ],
      primaryActionId: "update_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "OpenMeld is not set up on this computer.",
      kind: "local_service",
      patterns: ["background_helper.not_installed"],
      primaryActionId: "connect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `The computer is connected, but ${formatObjectTargetName(targetName)} did not become ready in time for this Wake. Try waking the Agent again in a moment.`,
      kind: "system_retry",
      patterns: ["=daemon.profile.pending_first_report"],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${formatObjectTargetName(targetName)} did not start before the deadline. This Wake has expired and will not run when the computer reconnects. Send a new Wake if the work is still needed.`,
      kind: "request_ended",
      patterns: ["=wake.device_wait.expired"],
      recoveryTarget: null,
    },
    {
      body: "This waiting Wake could not start because its requester or Agent no longer has access to this Space. Review access before sending a new Wake.",
      kind: "request_ended",
      patterns: ["=wake.device_wait.access_revoked"],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `OpenMeld could not reach ${formatObjectTargetName(targetName)} on this computer for this Wake. Reconnect the computer, then try again.`,
      kind: "local_service",
      patterns: [
        "daemon.profile.offline",
        "daemon.session.not_found",
        "local_service.",
        "route.",
        "service.",
        "service.not_running",
      ],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: buildMalformedSpaceReplyCopy,
      kind: "system_retry",
      mappedReasonBody: buildMalformedSpaceReplyCopy,
      patterns: ["=openmeld.space_action.repair_failed"],
      preferMappedReasonDetailPatterns: [
        "replied, but not with a valid space reply action",
        "finished, but openmeld couldn't post its reply",
        "finished, but openmeld could not post its reply",
        "finished, but did not produce a valid space reply",
        "finished, but its reply could not be posted",
        "finished, but the reply could not be posted",
        "openmeld did not receive a message it could post in this space",
      ],
      recoveryTarget: null,
    },
    {
      body: buildEmptyAgentReplyCopy,
      kind: "system_retry",
      mappedReasonBody: buildEmptyAgentReplyCopy,
      patterns: ["=runtime.reply.empty_output"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: buildMissingAgentReplyIdentityCopy,
      kind: "system_retry",
      mappedReasonBody: buildMissingAgentReplyIdentityCopy,
      patterns: ["=runtime.reply.metadata_missing.agent_controller_ref"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: "OpenMeld found more than one install for this agent on this device. Choose which one OpenMeld should use here, then try again.",
      kind: "local_agent_prepare",
      patterns: ["controller.launch.choice_required", "launch choice"],
      primaryActionId: "choose_local_agent",
      recoveryTarget: "computer",
    },
    {
      body: "Claude project tasks need Docker or Podman running on the Agent's computer. Start a Linux container engine, then try again. For a reply without project files, choose a Space-only task.",
      kind: "local_agent_prepare",
      patterns: ["=claude_project.container_runtime_unavailable"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "Docker or Podman could not prepare the image for this Claude project task. Check the container engine and its image download, then try again.",
      kind: "local_agent_prepare",
      patterns: ["=claude_project.image_unavailable"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "OpenMeld couldn't verify this Claude project task's file isolation. Check Docker or Podman and this Agent's settings before starting another project task. Open Diagnostics for the failed check.",
      kind: "local_agent_prepare",
      patterns: [
        "=claude_project.isolation_unverified",
        "=claude_project.inside_access_unverified",
        "=claude_project.outside_access_unverified",
        "=claude_project.inside_write_unverified",
      ],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "OpenMeld couldn't confirm this Claude Agent's permission rules. Check that its Claude settings files can be read and contain valid JSON, then wake the Agent again.",
      kind: "local_agent_prepare",
      patterns: [
        "=claude_delivery_policy.unavailable",
        "=claude_delivery_policy.invalid",
      ],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "Select the official Antigravity ACP installation and sign in on this computer, then start a new task. The legacy Antigravity CLI cannot run independent tasks.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.antigravity_acp_required"],
      primaryActionId: "manage_local_agent",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "This Agent cannot apply the selected task access limits. Start a new task using Agent settings, or choose an Agent that supports these limits.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.controller_access_unsupported"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "The selected task is not available to continue or fork. Select an available task that you started, or start a new task.",
      kind: "request_ended",
      patterns: ["=execution_context.source_unavailable"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: "This Agent cannot fork task history. Continue the original task, or start a new task with no previous history.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.fork_unsupported"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "This independent project task needs a connected Git repository with at least one commit. Choose that repository's root as the Agent's working folder, then start a new task.",
      kind: "local_agent_prepare",
      patterns: [
        "execution_context.project_repository_required",
        "execution_context.project_repository_root_required",
        "execution_context.project_commit_required",
      ],
      primaryActionId: "manage_local_agent",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "The requested commit is not available in the Agent's Project connection. Fetch that published commit on the Agent's computer, then send a new handoff.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.project_revision_unavailable"],
      primaryActionId: "check_status",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "The current folder is on a different commit. Choose a separate copy for the requested revision, or switch the connected checkout before sending a new handoff.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.project_revision_mismatch"],
      primaryActionId: "check_status",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "The current folder has local changes. Choose a separate copy, or finish those changes before handing off a fixed revision.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.project_worktree_dirty"],
      primaryActionId: "check_status",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: CODE_HANDOFF_RECEIVER_UNSUPPORTED_PUBLIC_COPY,
      kind: "local_agent_prepare",
      patterns: ["=space.handoff.code_receiver_unsupported"],
      primaryActionId: "manage_local_agent",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "agents",
    },
    {
      body: "This Agent cannot receive the selected handoff materials. Choose a supported Agent and send a new handoff. Shared files without a repository require Codex or a Remote Agent.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.handoff_receiver_unsupported"],
      primaryActionId: "manage_local_agent",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "agents",
    },
    {
      body: "This Agent's connection cannot enforce the handoff's file-access limits. Use a Codex Agent connected through App Server, or another supported Agent, then send a new handoff.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.handoff_transport_unsupported"],
      primaryActionId: "manage_local_agent",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "agents",
    },
    {
      body: "OpenMeld could not verify file-access limits with this Agent's previous permission settings, so the task did not start. Choose Ask for approval, Approve for me, or Full access in this Agent's settings, then try again.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.custom_config_file_access_unverified"],
      primaryActionId: "manage_local_agent",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "The Agent owner's request can no longer be verified. The task did not start. Ask the owner to send the task again.",
      kind: "local_agent_prepare",
      patterns: ["=execution_context.owner_request_unavailable"],
      primaryActionId: "check_status",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "OpenMeld couldn't verify this task's project file boundary. Check this computer's file-access settings and use a task workspace outside system temporary folders, then start a new task.",
      kind: "local_agent_prepare",
      patterns: [
        "execution_context.workspace_access_unverified",
        "execution_context.workspace_probe_unsupported",
        "execution_context.workspace_probe_timeout",
      ],
      primaryActionId: "manage_local_agent",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "This local Agent couldn't start with only the tools authorized for this task. Check the Agent's MCP configuration, then start a new task.",
      kind: "local_agent_prepare",
      patterns: [
        "execution_context.mcp_server_namespace_conflict",
        "execution_context.mcp_inventory_timeout",
        "context.mcp_isolation_unverified",
      ],
      primaryActionId: "manage_local_agent",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "OpenMeld couldn't start the tools required for this task. Open Diagnostics for details, then wake the agent again.",
      kind: "local_agent_prepare",
      patterns: ["execution_context.mcp_server_initialization_failed"],
      primaryActionId: "manage_local_agent",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "computer",
    },
    {
      body: "This task did not start because its conversation uses a different folder. Send it again to choose how to continue. The previous conversation is saved.",
      kind: "request_ended",
      patterns: [
        "=context.workspace_mismatch",
        "=context.workspace_unavailable",
        "=context.workspace_recovery_changed",
        "=context.workspace_recovery_unanswered",
      ],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: "The Computer owner stopped this task before the Agent started. The previous conversation is saved.",
      kind: "request_ended",
      patterns: ["=context.workspace_recovery_declined"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: "OpenMeld could not read this conversation’s folder. Open the conversation in OpenCode, then try this task again.",
      kind: "request_ended",
      patterns: ["=context.workspace_verification_unavailable"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: "This task ended while waiting for a response. Send it again when you’re ready.",
      kind: "request_ended",
      patterns: [
        "=interaction.expired",
        "=runtime_coordinator.interaction_expired",
      ],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Working folder missing",
      availabilitySummary: "Choose a working folder for this Agent.",
      availabilityTooltip: "Working folder missing",
      body: (targetName) =>
        `${targetName} couldn’t start because its working folder is not configured on the computer that runs it. Choose a working folder, then try again.`,
      kind: "local_agent_prepare",
      patterns: ["workspace.missing", "profile.workspace.missing"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "working_folder",
    },
    {
      availabilityBadgeLabel: "Working folder unavailable",
      availabilitySummary: "Review this Agent’s working folder.",
      availabilityTooltip: "Working folder unavailable",
      body: (targetName) =>
        `${targetName} couldn’t start because its working folder could not be used on the computer that runs it. Review that folder, then try again.`,
      kind: "local_agent_prepare",
      patterns: ["workspace.invalid", "profile.workspace.invalid"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "working_folder",
    },
    {
      body: CODEX_UPGRADE_REQUIRED_REASON,
      kind: "local_agent_prepare",
      patterns: ["controller.client.upgrade_required"],
      primaryActionId: "manage_local_agent",
      recoveryTarget: "computer",
    },
    {
      body: "This local agent is not available on the computer that runs this Agent. Check its installation on that computer, then try again.",
      kind: "local_agent_prepare",
      patterns: ["controller.runtime.missing"],
      primaryActionId: "manage_local_agent",
      recoveryTarget: "computer",
    },
    {
      body: (targetName) =>
        `${targetName} could not start on this device. Repair it on this device, then try again.`,
      kind: "local_agent_prepare",
      patterns: ["controller.launch.needs_repair"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "computer",
    },
    {
      availabilityBadgeLabel: "Turned off",
      availabilitySummary:
        "This local agent is turned off in OpenMeld on this computer. Turn it on before this profile can reply.",
      availabilityTooltip:
        "This local agent is turned off in OpenMeld on this computer.",
      body: (targetName) =>
        `${targetName}'s local agent is turned off in OpenMeld on this computer. Turn it on, then wake the agent again.`,
      kind: "local_agent_prepare",
      mappedReasonBody:
        "This local agent is turned off in OpenMeld on this computer. Turn it on, then wake the agent again.",
      patterns: ["=controller.registry.disabled"],
      primaryActionId: "turn_on_local_agent",
      recoveryTarget: "computer",
    },
    {
      availabilityBadgeLabel: "Needs attention",
      availabilitySummary:
        "Check the local agent's status on the computer that runs it.",
      availabilityTooltip: "Local agent setup needs attention",
      body: (targetName) =>
        `${targetName}'s local agent could not complete setup on its computer. Check its status on that computer, then try again.`,
      kind: "local_agent_prepare",
      patterns: [
        "=controller.bootstrap.failed",
        "=controller.gateway.unhealthy",
      ],
      primaryActionId: "check_status",
      recoveryTarget: "computer",
    },
    {
      body: "The model provider rejected this request because the provider credentials are invalid or expired. Reconnect the provider account, then wake the agent again.",
      kind: "account_access",
      mappedReasonBody:
        "The model provider rejected this request because the provider credentials are invalid or expired. Reconnect the provider account, then wake the agent again.",
      patterns: ["auth", "credential", "login"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `${targetName} asked for permission before it could continue. OpenMeld cannot collect that permission response yet. Review the Agent Profile’s permission mode, then wake the agent again.`,
      kind: "account_access",
      mappedReasonBody: INTERACTION_PERMISSION_REQUIRED_PUBLIC_COPY,
      patterns: ["=interaction.permission_required"],
      primaryActionId: "review_agent_permissions",
      recoveryTarget: "agents",
    },
    {
      body: INTERACTION_QUESTION_REQUIRED_PUBLIC_COPY,
      kind: "system_retry",
      patterns: ["=interaction.question_required"],
      recoveryTarget: null,
    },
    {
      body: INTERACTION_PLAN_REQUIRED_PUBLIC_COPY,
      kind: "system_retry",
      patterns: ["=interaction.plan_required"],
      recoveryTarget: null,
    },
    {
      body: INTERACTION_UNSUPPORTED_PUBLIC_COPY,
      kind: "system_retry",
      patterns: ["=interaction.unsupported"],
      recoveryTarget: null,
    },
    {
      body: "The selected local agent is not ready to connect. Finish local agent setup on the Computer, then retry setup.",
      kind: "local_agent_prepare",
      patterns: ["=agent_profile_creation_request.local_agent_not_ready"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "The selected model isn't offered by this local agent. Choose another model or update the local agent, then retry setup.",
      kind: "local_agent_prepare",
      patterns: ["=agent_profile_creation_request.model_not_offered"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: "The selected model requires a newer local agent. Update the local agent or choose another model, then retry setup.",
      kind: "local_agent_prepare",
      patterns: [
        "=agent_profile_creation_request.model_requires_newer_controller",
      ],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: UNSUPPORTED_REASONING_PUBLIC_COPY,
      kind: "account_access",
      patterns: ["=model.reasoning_unsupported"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: CURSOR_MODEL_INVENTORY_UNAVAILABLE_PUBLIC_COPY,
      kind: "system_retry",
      patterns: ["=model.inventory_unavailable"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: UNSUPPORTED_MODEL_PUBLIC_COPY,
      kind: "account_access",
      patterns: ["model.unsupported", "unsupported_model"],
      preferMappedReasonOverDetail: true,
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: "The model provider rejected this request because the provider account does not have enough credits or quota. Add credits, increase the provider quota, or update billing, then wake the agent again.",
      kind: "account_access",
      mappedReasonBody:
        "The model provider rejected this request because the provider account does not have enough credits or quota. Add credits, increase the provider quota, or update billing, then wake the agent again.",
      patterns: ["quota"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: "The model provider rate-limited this request. Wait a moment or raise the provider limit, then wake the agent again.",
      kind: "account_access",
      mappedReasonBody:
        "The model provider rate-limited this request. Wait a moment or raise the provider limit, then wake the agent again.",
      patterns: ["rate"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: "The agent does not have permission to reply here.",
      kind: "account_access",
      patterns: ["forbidden", "permission", "unauthorized"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: "The model provider was unreachable. Check provider status or network access, then wake the agent again.",
      kind: "unknown",
      mappedReasonBody:
        "The model provider was unreachable. Check provider status or network access, then wake the agent again.",
      patterns: ["network", "provider", "unavailable", "upstream"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
  ] as const;

export function resolvePublicAgentFailureRecovery(input: {
  errorCode: string | null | undefined;
  includeUnknown?: boolean;
  targetLabel?: string | null | undefined;
}): PublicAgentFailureRecovery | null {
  const normalizedErrorCode = normalizeOptionalText(
    input.errorCode
  )?.toLowerCase();
  if (!normalizedErrorCode) {
    return null;
  }

  const targetName = normalizeOptionalText(input.targetLabel) ?? "This agent";
  const mapping = findPublicFailureRecoveryMapping(normalizedErrorCode);
  if (!mapping) {
    return input.includeUnknown === false
      ? null
      : {
          body: `OpenMeld did not receive enough error details to explain why ${targetName} could not reply. Open diagnostics for technical details.`,
          kind: "unknown",
          recoveryTarget: null,
        };
  }

  const body = resolvePublicAgentFailureBody(mapping.body, targetName);
  if (mapping.recoveryTarget === null) {
    return {
      body,
      kind: mapping.kind,
      recoveryTarget: null,
    };
  }

  return {
    body,
    kind: mapping.kind,
    primaryActionId: mapping.primaryActionId,
    primaryActionLabel: formatAgentRecoveryActionLabel(mapping.primaryActionId),
    recoveryTarget: mapping.recoveryTarget,
  };
}

export function resolveMappedPublicAgentFailureReason(
  errorCode: string | null | undefined,
  targetLabel?: string | null | undefined
): string | null {
  const normalizedErrorCode = normalizeOptionalText(errorCode)?.toLowerCase();
  if (!normalizedErrorCode) {
    return null;
  }

  const mapping = findMappedFailureRecovery(normalizedErrorCode);
  if (!mapping) {
    return null;
  }

  return resolvePublicAgentFailureBody(
    mapping.mappedReasonBody ?? mapping.body,
    normalizeOptionalText(targetLabel) ?? "This agent"
  );
}

function findMappedFailureRecovery(errorCode: string) {
  return PUBLIC_FAILURE_RECOVERY_BY_CODE.find((candidate) =>
    candidate.patterns.some((pattern) =>
      matchesPublicFailureReasonPattern(errorCode, pattern)
    )
  );
}

function resolveFailureCauseOnly(
  reasonCode: string,
  agentLabel: string
): readonly [string, string] | null {
  const callbackCause = CENTER_AGENT_CALLBACK_COPY_BY_CODE[reasonCode]?.cause;
  if (callbackCause) {
    return callbackCause;
  }
  const cause = findMappedFailureRecovery(reasonCode.toLowerCase())?.cause;
  return cause
    ? [
        resolvePublicAgentFailureBody(cause[0], agentLabel),
        resolvePublicAgentFailureBody(cause[1], agentLabel),
      ]
    : null;
}

export function shouldPreferMappedPublicAgentFailureReason(
  errorCode: string | null | undefined,
  detail?: string | null | undefined
): boolean {
  const normalizedErrorCode = normalizeOptionalText(errorCode)?.toLowerCase();
  if (!normalizedErrorCode) {
    return false;
  }

  const mapping = findPublicFailureRecoveryMapping(normalizedErrorCode);
  if (!mapping) {
    return false;
  }
  if (mapping.preferMappedReasonOverDetail) {
    return true;
  }

  const normalizedDetail = normalizeOptionalText(detail)?.toLowerCase();
  return normalizedDetail
    ? (mapping.preferMappedReasonDetailPatterns?.some((pattern) =>
        normalizedDetail.includes(pattern)
      ) ?? false)
    : false;
}

export function isProjectLocalConnectionFailureReasonCode(
  value: string | null | undefined
): value is ProjectLocalConnectionFailureReasonCode {
  return projectLocalConnectionFailureReasonCodeSchema.safeParse(value).success;
}

export function resolvePublicAgentAvailabilityCopy(
  reasonCode: string | null | undefined,
  context: PublicAgentAvailabilityCopyContext = {}
): PublicAgentAvailabilityCopy | null {
  const normalizedReasonCode = normalizeOptionalText(reasonCode)?.toLowerCase();
  if (!normalizedReasonCode) {
    return null;
  }

  const mapping =
    PUBLIC_AGENT_AVAILABILITY_ONLY_COPY_BY_CODE.find((candidate) =>
      candidate.patterns.some((pattern) =>
        matchesPublicFailureReasonPattern(normalizedReasonCode, pattern)
      )
    ) ??
    PUBLIC_FAILURE_RECOVERY_BY_CODE.find(
      (candidate) =>
        candidate.availabilitySummary !== undefined &&
        candidate.patterns.some((pattern) =>
          matchesPublicFailureReasonPattern(normalizedReasonCode, pattern)
        )
    ) ??
    null;
  if (!mapping) {
    return null;
  }

  return {
    availabilityBadgeLabel: resolvePublicAgentAvailabilityCopyValue(
      mapping.availabilityBadgeLabel,
      context
    ),
    availabilitySummary: resolvePublicAgentAvailabilityCopyValue(
      mapping.availabilitySummary,
      context
    ),
    availabilityTooltip: resolvePublicAgentAvailabilityCopyValue(
      mapping.availabilityTooltip,
      context
    ),
    controllerInterfaceDescription: resolvePublicAgentAvailabilityCopyValue(
      mapping.controllerInterfaceDescription,
      context
    ),
    controllerInterfaceDescriptionFallback:
      resolvePublicAgentAvailabilityCopyValue(
        mapping.controllerInterfaceDescriptionFallback,
        context
      ),
    manualOnlyAgentDetail: resolvePublicAgentAvailabilityCopyValue(
      mapping.manualOnlyAgentDetail,
      context
    ),
  };
}

function resolvePublicAgentAvailabilityCopyValue(
  value: PublicAgentAvailabilityCopyValue | undefined,
  context: PublicAgentAvailabilityCopyContext
): string | undefined {
  return typeof value === "function" ? value(context) : value;
}

function resolveControllerSignInAvailabilityCopy(
  context: PublicAgentAvailabilityCopyContext
): {
  controllerInterfaceDescription?: string;
  summary: string;
  tooltip: string;
} {
  return (
    CONTROLLER_SIGN_IN_AVAILABILITY_COPY_BY_ID[
      context.agentControllerId ?? ""
    ] ?? DEFAULT_CONTROLLER_SIGN_IN_AVAILABILITY_COPY
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function formatObjectTargetName(targetName: string): string {
  return targetName === "This agent" ? "this agent" : targetName;
}

function formatPossessiveTargetName(targetName: string): string {
  const objectTargetName = formatObjectTargetName(targetName);
  return objectTargetName.endsWith("s")
    ? `${objectTargetName}'`
    : `${objectTargetName}'s`;
}

function matchesPublicFailureReasonPattern(
  normalizedErrorCode: string,
  pattern: string
): boolean {
  if (pattern.startsWith(EXACT_PATTERN_PREFIX)) {
    return normalizedErrorCode === pattern.slice(EXACT_PATTERN_PREFIX.length);
  }
  return normalizedErrorCode.includes(pattern);
}

function findPublicFailureRecoveryMapping(
  normalizedErrorCode: string
): PublicAgentFailureRecoveryMapping | null {
  return (
    PUBLIC_FAILURE_RECOVERY_BY_CODE.find((candidate) =>
      candidate.patterns.some((pattern) =>
        matchesPublicFailureReasonPattern(normalizedErrorCode, pattern)
      )
    ) ?? null
  );
}

function resolvePublicAgentFailureBody(
  body: string | ((targetName: string) => string),
  targetName: string
): string {
  return typeof body === "function" ? body(targetName) : body;
}
