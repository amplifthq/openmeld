import { describe, expect, it } from "vitest";
import {
  agentFailureFactsSchema,
  formatPublicAgentFailureFacts,
  formatPublicInterruptedTaskFailureFacts,
  formatPublicRoutineFailureFacts,
} from "../src";
import type { AgentFailureFacts } from "../src/types";

const exhausted: AgentFailureFacts = {
  v: 1,
  reasonCode: "remote_agent.admission_timeout",
  stage: "admission",
  executionConfirmation: "unknown",
  result: { status: "unknown" },
  retry: { status: "exhausted", attempt: 3, maxAttempts: 3 },
  recovery: { status: "none" },
  recoveryActions: [],
  diagnosticReference: {
    spaceId: "space-parent",
    dispatchId: "continuation-1",
  },
};

const UNSUPPORTED_INTERRUPTION_GUIDANCE = /overloaded|过载|Try again|重新发起/u;

describe("owner-supplied public failure facts", () => {
  it.each([
    "en",
    "zh-Hans",
  ])("explains interrupted processing without guessing its cause or replaying child work in %s", (languageTag) => {
    const facts = agentFailureFactsSchema.parse({
      ...exhausted,
      reasonCode: "remote_agent.turn_not_completed",
      stage: "execution",
      languageTag,
      retry: { status: "none" },
      completedResults: [
        {
          resultRef: "child-result",
          url: "/spaces/source?signalId=child-result",
        },
      ],
      recoveryActions: ["continue_task_continuation"],
    });
    const presentation = formatPublicInterruptedTaskFailureFacts(facts);
    expect(presentation.body).toContain("/spaces/source?signalId=child-result");
    expect(presentation.body).toContain(
      languageTag === "en"
        ? "does not continue the remaining work"
        : "不会继续剩余工作"
    );
    expect(presentation.body).toContain(
      languageTag === "en"
        ? "Earlier actions may have taken effect"
        : "之前的操作可能已经生效"
    );
    expect(presentation.body).not.toMatch(UNSUPPORTED_INTERRUPTION_GUIDANCE);
    const noRecovery = formatPublicInterruptedTaskFailureFacts({
      ...facts,
      completedResults: [],
      recoveryActions: [],
    });
    expect(noRecovery.body).not.toContain(
      languageTag === "en" ? "You can ask" : "你可以请"
    );
    expect(noRecovery.body).not.toContain("child-result");
  });

  it.each([
    [
      "remote_agent.provider.connection_missing",
      "couldn't connect to its model provider",
      "无法连接到模型提供方",
    ],
    ["provider.rate_limited", "rate-limited", "限制了这次请求的频率"],
    [
      "auth.required",
      "rejected the local agent's sign-in",
      "拒绝了本地 Agent 的登录凭据",
    ],
    [
      "permission.denied.runtime",
      "permission settings blocked",
      "权限设置阻止",
    ],
    ["provider.unavailable", "model is not responding", "模型目前没有响应"],
  ])("keeps cause %s separate from unsafe retry guidance in both languages", (reasonCode, englishCause, chineseCause) => {
    for (const [languageTag, cause] of [
      ["en", englishCause],
      ["zh-Hans", chineseCause],
    ]) {
      const presentation = formatPublicAgentFailureFacts(
        agentFailureFactsSchema.parse({
          ...exhausted,
          reasonCode,
          languageTag,
          retry: { status: "none" },
        })
      );
      expect(presentation.body).toContain(cause);
      expect(presentation.body).toContain(
        languageTag === "en"
          ? "Earlier actions may have taken effect"
          : "之前的操作可能已经生效"
      );
      expect(presentation.body).not.toContain("wake the agent again");
      expect(presentation.body).not.toContain("Try again");
      expect(presentation.body).not.toContain("synthetic-private");
    }
  });
  it.each([
    "not_executed",
    "executed",
    "unknown",
  ] as const)("keeps execution confirmation %s separate from result availability", (executionConfirmation) => {
    const facts = agentFailureFactsSchema.parse({
      ...exhausted,
      executionConfirmation,
    });
    expect(facts.executionConfirmation).toBe(executionConfirmation);
    expect(facts.result.status).toBe("unknown");
  });

  it("uses unknown confirmation for a legacy projection or a future enum value", () => {
    const { executionConfirmation: _confirmation, ...legacy } = exhausted;
    expect(agentFailureFactsSchema.parse(legacy).executionConfirmation).toBe(
      "unknown"
    );
    expect(
      agentFailureFactsSchema.parse({
        ...legacy,
        executionConfirmation: "future_confirmation",
      }).executionConfirmation
    ).toBe("unknown");
  });
  it.each([
    ["en", "no automatic recovery", "may repeat earlier actions"],
    ["zh-Hans", "不会再自动恢复", "可能重复执行"],
  ])("renders exhausted uncertainty in the known task language %s", (languageTag, stopped, duplicate) => {
    const facts = agentFailureFactsSchema.parse({ ...exhausted, languageTag });
    const presentation = formatPublicAgentFailureFacts(facts);
    expect(presentation.severity).toBe("warning");
    expect(presentation.body).toContain(stopped);
    expect(presentation.body).toContain(duplicate);
    expect(presentation.body).toContain(
      languageTag === "en"
        ? "summarize the existing results instead of resending"
        : "基于已有结果重新汇总，不要重发原请求"
    );
    expect(presentation.body).not.toContain("never started");
  });

  it.each([
    "en",
    "zh-Hans",
  ])("does not warn about duplicate actions when the owner confirms no execution in %s", (languageTag) => {
    const presentation = formatPublicAgentFailureFacts(
      agentFailureFactsSchema.parse({
        ...exhausted,
        languageTag,
        executionConfirmation: "not_executed",
      })
    );
    expect(presentation.body).toContain(
      languageTag === "en" ? "did not execute" : "没有执行"
    );
    expect(presentation.body).not.toContain("may repeat");
    expect(presentation.body).not.toContain("可能重复");
  });

  it.each([
    "en",
    "zh-Hans",
  ])("names confirmed execution without claiming a confirmed result in %s", (languageTag) => {
    const presentation = formatPublicAgentFailureFacts(
      agentFailureFactsSchema.parse({
        ...exhausted,
        retry: { status: "none" },
        languageTag,
        executionConfirmation: "executed",
      })
    );
    expect(presentation.body).toContain(
      languageTag === "en" ? "This task ran" : "这次任务已经执行"
    );
    expect(presentation.body).not.toContain("did not start");
    expect(presentation.severity).toBe("warning");
  });

  it.each([
    "en",
    "zh-Hans",
  ])("distinguishes retry, permission, publication and actual recovery in %s", (languageTag) => {
    const facts = { ...exhausted, languageTag };
    const retrying = formatPublicAgentFailureFacts(
      agentFailureFactsSchema.parse({
        ...facts,
        retry: { status: "scheduled", nextAttemptAtMs: 1000 },
      })
    );
    expect(retrying.severity).toBe("neutral");
    const stopped = formatPublicAgentFailureFacts(
      agentFailureFactsSchema.parse({
        ...facts,
        reasonCode: "remote_agent.execution_cancelled",
        retry: { status: "scheduled", nextAttemptAtMs: 1000 },
      })
    );
    expect(stopped.severity).toBe("neutral");
    expect(stopped.body).not.toContain("handling recovery");
    expect(stopped.body).not.toContain("正在处理");
    const permissions = formatPublicAgentFailureFacts(
      agentFailureFactsSchema.parse({
        ...facts,
        reasonCode: "execution_context.custom_config_file_access_unverified",
        result: { status: "not_started" },
        retry: { status: "none" },
        recoveryActions: ["review_agent_permissions"],
      })
    );
    expect(permissions.severity).toBe("warning");
    const retained = {
      ...facts,
      reasonCode: "remote_agent.callback_publish_failed",
      stage: "publication",
      result: { status: "retained", resultRef: "result-1" },
      retry: { status: "none" },
    };
    expect(
      formatPublicAgentFailureFacts(agentFailureFactsSchema.parse(retained))
        .severity
    ).toBe("error");
    expect(
      formatPublicAgentFailureFacts(
        agentFailureFactsSchema.parse({
          ...retained,
          recovery: {
            status: "recovered",
            operationId: "recovery-1",
            resultRef: "result-1",
          },
        })
      ).severity
    ).toBe("neutral");
    const published = formatPublicAgentFailureFacts(
      agentFailureFactsSchema.parse({
        ...retained,
        result: { status: "published", resultRef: "result-1" },
      })
    );
    expect(published.body).not.toContain("could not publish");
    expect(published.body).not.toContain("未能发布");
  });

  it.each([
    ["en", "Earlier actions may have taken effect", "View Run details"],
    ["zh-Hans", "之前的操作可能已经生效", "查看 Run 详情"],
  ])("keeps a Routine callback's uncertain side effects and Run locator in %s", (languageTag, uncertainty, linkLabel) => {
    const text = formatPublicRoutineFailureFacts(
      agentFailureFactsSchema.parse({
        ...exhausted,
        reasonCode: "remote_agent.empty_assistant_response",
        stage: "execution",
        result: { status: "unavailable" },
        retry: { status: "none" },
        languageTag,
      }),
      {
        routineName: "Daily review",
        runId: "run-1",
        runUrl: "https://staging.example/routines?runId=run-1",
      }
    );
    expect(text).toContain(uncertainty);
    expect(text).toContain("Run ID: run-1");
    expect(text).toContain(
      `[${linkLabel}](https://staging.example/routines?runId=run-1)`
    );
    expect(text).not.toContain("could not run");
  });

  it("refuses a recovered label without the same confirmed result", () => {
    expect(
      agentFailureFactsSchema.safeParse({
        ...exhausted,
        recovery: {
          status: "recovered",
          operationId: "recovery-1",
          resultRef: "result-1",
        },
      }).success
    ).toBe(false);
    expect(
      agentFailureFactsSchema.safeParse({
        ...exhausted,
        result: { status: "retained", resultRef: "another-result" },
        recovery: {
          status: "recovered",
          operationId: "recovery-1",
          resultRef: "result-1",
        },
      }).success
    ).toBe(false);
    expect(
      agentFailureFactsSchema.safeParse({
        ...exhausted,
        retry: { status: "exhausted", attempt: 4, maxAttempts: 3 },
      }).success
    ).toBe(false);
  });

  it.each([
    [
      "remote_agent.provider.connection_missing",
      "en",
      "Research Agent couldn't connect to its model provider",
    ],
    [
      "remote_agent.turn.context_window_exceeded",
      "en",
      "conversation has grown too long",
    ],
    [
      "remote_agent.turn.context_window_exceeded",
      "zh-Hans",
      "对话内容超过了模型",
    ],
    [
      "remote_agent.execution_identity_mismatch",
      "en",
      "could not confirm the reply's Agent identity",
    ],
    [
      "remote_agent.execution_identity_mismatch",
      "zh-Hans",
      "无法确认回复的 Agent 身份",
    ],
    [
      "remote_agent.work_loop_continuation_limit_exceeded",
      "en",
      "safe execution limit",
    ],
    [
      "remote_agent.work_loop_continuation_limit_exceeded",
      "zh-Hans",
      "安全执行上限",
    ],
  ])("preserves the known %s cause separately from outcome uncertainty in %s", (reasonCode, languageTag, cause) => {
    const facts = agentFailureFactsSchema.parse({
      ...exhausted,
      reasonCode,
      stage: "execution",
      retry: { status: "none" },
      languageTag,
    });
    const presentation = formatPublicAgentFailureFacts(facts, {
      agentLabel: "Research Agent",
    });
    expect(presentation.body).toContain(cause);
    expect(presentation.body).toContain(
      languageTag === "en"
        ? "Earlier actions may have taken effect"
        : "之前的操作可能已经生效"
    );
    expect(presentation.body).not.toContain("could not run");
    expect(presentation.body).not.toContain("Try again;");
    expect(presentation.body).not.toContain("Send the request again");
  });
});
