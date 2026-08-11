import { describe, expect, it } from "vitest";
import {
  buildMentionDispatchResultEnvelope,
  planMentionDispatchDecisions,
} from "../src/mention-decision-chain";

describe("mention decision chain", () => {
  it("returns empty decisions when message has no mentions", () => {
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => "dispatch-1",
      resolveMentionTargetLabel: () => null,
      senderProfileId: "agt-sender",
      sourceEventId: "evt-1",
      text: "hello world",
    });

    expect(decisions).toEqual([]);
  });

  it("keeps mention order and dedupes same target inside one message", () => {
    let counter = 0;
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => `dispatch-${++counter}`,
      resolveMentionTargetLabel: (mention) => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId: mention,
      }),
      senderProfileId: "agt-sender",
      sourceEventId: "evt-2",
      text: "ping @agt-a(wake) then @agt-b(wake) and again @agt-a(wake)",
    });

    expect(decisions).toEqual([
      {
        dispatchId: "dispatch-1",
        sourceEventId: "evt-2",
        status: "dispatch_ready",
        targetProfileId: "agt-a",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      {
        dispatchId: "dispatch-2",
        sourceEventId: "evt-2",
        status: "dispatch_ready",
        targetProfileId: "agt-b",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    ]);
  });

  it("accepts mentions with trailing sentence punctuation", () => {
    let counter = 0;
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => `dispatch-${++counter}`,
      resolveMentionTargetLabel: (mention) => {
        if (mention === "my-codex") {
          return {
            bindingState: "bound",
            enabled: true,
            targetProfileId: "agt-my-codex",
          };
        }
        if (mention === "claude-code-agent") {
          return {
            bindingState: "bound",
            enabled: true,
            targetProfileId: "agt-claude-code-agent",
          };
        }
        return null;
      },
      senderProfileId: "usr-owner",
      sourceEventId: "evt-punctuation",
      text: "@my-codex(wake) say hi to @claude-code-agent(wake).",
    });

    expect(decisions).toEqual([
      {
        dispatchId: "dispatch-1",
        sourceEventId: "evt-punctuation",
        status: "dispatch_ready",
        targetProfileId: "agt-my-codex",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      {
        dispatchId: "dispatch-2",
        sourceEventId: "evt-punctuation",
        status: "dispatch_ready",
        targetProfileId: "agt-claude-code-agent",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    ]);
  });

  it("does not dispatch escaped mentions", () => {
    let counter = 0;
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => `dispatch-${++counter}`,
      resolveMentionTargetLabel: (mention) => {
        if (mention === "my-codex") {
          return {
            bindingState: "bound",
            enabled: true,
            targetProfileId: "agt-my-codex",
          };
        }
        if (mention === "claude-code-agent") {
          return {
            bindingState: "bound",
            enabled: true,
            targetProfileId: "agt-claude-code-agent",
          };
        }
        return null;
      },
      senderProfileId: "usr-owner",
      sourceEventId: "evt-escaped-mention",
      text: "@my-codex(wake) say hi to \\@claude-code-agent(wake)",
    });

    expect(decisions).toEqual([
      {
        dispatchId: "dispatch-1",
        sourceEventId: "evt-escaped-mention",
        status: "dispatch_ready",
        targetProfileId: "agt-my-codex",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    ]);
  });

  it("blocks self-trigger and continues other targets", () => {
    let counter = 0;
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => `dispatch-${++counter}`,
      resolveMentionTargetLabel: (mention) => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId: mention,
      }),
      senderProfileId: "agt-self",
      sourceEventId: "evt-3",
      text: "loop @agt-self(wake) then notify @agt-ok(wake)",
    });

    expect(decisions).toEqual([
      {
        dispatchId: "dispatch-1",
        errorCode: "dispatch.blocked.self_trigger",
        sourceEventId: "evt-3",
        status: "blocked",
        targetProfileId: "agt-self",
        ruleSource: "system",
        ruleId: "system.self_trigger.guard",
        ruleReason: "sender and target are the same profile",
      },
      {
        dispatchId: "dispatch-2",
        sourceEventId: "evt-3",
        status: "dispatch_ready",
        targetProfileId: "agt-ok",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    ]);
  });

  it("normalizes sender and target profile ids (trim) before self-trigger check", () => {
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => "dispatch-1",
      resolveMentionTargetLabel: () => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId: " agt-self ",
      }),
      senderProfileId: " agt-self ",
      sourceEventId: "evt-3b",
      text: "loop @agt-self(wake)",
    });

    expect(decisions).toEqual([
      {
        dispatchId: "dispatch-1",
        errorCode: "dispatch.blocked.self_trigger",
        sourceEventId: "evt-3b",
        status: "blocked",
        targetProfileId: "agt-self",
        ruleSource: "system",
        ruleId: "system.self_trigger.guard",
        ruleReason: "sender and target are the same profile",
      },
    ]);
  });

  it("marks invalid, disabled, and unbound targets as fail-fast while keeping valid targets", () => {
    let counter = 0;
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => `dispatch-${++counter}`,
      resolveMentionTargetLabel: (mention) => {
        if (mention === "agt-disabled") {
          return {
            bindingState: "bound",
            enabled: false,
            targetProfileId: mention,
          };
        }
        if (mention === "agt-unbound") {
          return {
            bindingState: "missing",
            enabled: true,
            targetProfileId: mention,
          };
        }
        if (mention === "agt-valid") {
          return {
            bindingState: "bound",
            enabled: true,
            targetProfileId: mention,
          };
        }
        return null;
      },
      senderProfileId: "agt-owner",
      sourceEventId: "evt-4",
      text: "test @agt-unknown(wake) @agt-disabled(wake) @agt-unbound(wake) @agt-valid(wake)",
    });

    expect(decisions).toEqual([
      {
        dispatchId: "dispatch-1",
        errorCode: "controller.ref.invalid",
        sourceEventId: "evt-4",
        status: "failed",
        targetProfileId: "agt-unknown",
        ruleSource: "system",
        ruleId: "system.target_resolution.invalid",
        ruleReason: "mention label cannot be resolved",
      },
      {
        dispatchId: "dispatch-2",
        errorCode: "controller.binding.disabled",
        sourceEventId: "evt-4",
        status: "failed",
        targetProfileId: "agt-disabled",
        ruleSource: "system",
        ruleId: "system.binding.disabled",
        ruleReason: "target binding exists but is disabled",
      },
      {
        dispatchId: "dispatch-3",
        errorCode: "controller.binding.missing",
        sourceEventId: "evt-4",
        status: "failed",
        targetProfileId: "agt-unbound",
        ruleSource: "system",
        ruleId: "system.binding.missing",
        ruleReason: "target profile has no controller binding",
      },
      {
        dispatchId: "dispatch-4",
        sourceEventId: "evt-4",
        status: "dispatch_ready",
        targetProfileId: "agt-valid",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    ]);
  });

  it("enforces dispatchRules precedence: space > profile > registry", () => {
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => "dispatch-1",
      dispatchRules: {
        space: {
          allow: false,
          ruleId: "space.owner_only.v1",
          ruleReason: "space only allows owner mentions",
        },
        profile: {
          allow: true,
          ruleId: "profile.allow_all.v1",
          ruleReason: "profile allows all mentions",
        },
        registry: {
          allow: true,
          ruleId: "registry.default.all_members.v1",
          ruleReason: "default allow all members mention",
        },
      },
      resolveMentionTargetLabel: () => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId: "agt-worker",
      }),
      senderProfileId: "agt-owner",
      sourceEventId: "evt-5",
      text: "ping @agt-worker(wake)",
    });

    expect(decisions).toEqual([
      {
        dispatchId: "dispatch-1",
        sourceEventId: "evt-5",
        status: "blocked",
        targetProfileId: "agt-worker",
        errorCode: "dispatch.rules.denied",
        ruleSource: "space",
        ruleId: "space.owner_only.v1",
        ruleReason: "space only allows owner mentions",
      },
    ]);
  });

  it("uses profile rule when space rule is absent", () => {
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => "dispatch-1",
      dispatchRules: {
        profile: {
          allow: false,
          ruleId: "profile.human_only.v1",
          ruleReason: "profile denies agent mentions",
        },
      },
      resolveMentionTargetLabel: () => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId: "agt-worker",
      }),
      senderProfileId: "agt-owner",
      sourceEventId: "evt-6",
      text: "ping @agt-worker(wake)",
    });

    expect(decisions[0]).toMatchObject({
      status: "blocked",
      errorCode: "dispatch.rules.denied",
      ruleSource: "profile",
      ruleId: "profile.human_only.v1",
    });
  });

  it("uses registry rule when higher-priority rules are absent", () => {
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => "dispatch-1",
      dispatchRules: {
        registry: {
          allow: false,
          ruleId: "registry.deny_all.v1",
          ruleReason: "registry maintenance deny",
        },
      },
      resolveMentionTargetLabel: () => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId: "agt-worker",
      }),
      senderProfileId: "agt-owner",
      sourceEventId: "evt-7",
      text: "ping @agt-worker(wake)",
    });

    expect(decisions[0]).toMatchObject({
      status: "blocked",
      errorCode: "dispatch.rules.denied",
      ruleSource: "registry",
      ruleId: "registry.deny_all.v1",
    });
  });

  it("applies self-trigger guard before dispatchPolicy compatibility check", () => {
    const decisions = planMentionDispatchDecisions({
      createDispatchId: (() => {
        let counter = 0;
        return () => `dispatch-${++counter}`;
      })(),
      dispatchPolicy: "manual" as never,
      resolveMentionTargetLabel: (mention) => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId: mention,
      }),
      senderProfileId: "agt-self",
      sourceEventId: "evt-8a",
      text: "ping @agt-self(wake) and @agt-other(wake)",
    });

    expect(decisions).toEqual([
      {
        dispatchId: "dispatch-1",
        errorCode: "dispatch.blocked.self_trigger",
        sourceEventId: "evt-8a",
        status: "blocked",
        targetProfileId: "agt-self",
        ruleSource: "system",
        ruleId: "system.self_trigger.guard",
        ruleReason: "sender and target are the same profile",
      },
      {
        dispatchId: "dispatch-2",
        errorCode: "dispatch.policy.unsupported",
        sourceEventId: "evt-8a",
        status: "blocked",
        targetProfileId: "agt-other",
        ruleSource: "system",
        ruleId: "system.dispatch_policy.unsupported",
        ruleReason: "unsupported dispatchPolicy: manual",
      },
    ]);
  });

  it("applies dispatchRules before dispatchPolicy compatibility check", () => {
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => "dispatch-1",
      dispatchPolicy: "manual" as never,
      dispatchRules: {
        space: {
          allow: false,
          ruleId: "space.owner_only.v1",
          ruleReason: "space only allows owner mentions",
        },
      },
      resolveMentionTargetLabel: () => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId: "agt-target",
      }),
      senderProfileId: "agt-owner",
      sourceEventId: "evt-8b",
      text: "ping @agt-target(wake)",
    });

    expect(decisions).toEqual([
      {
        dispatchId: "dispatch-1",
        errorCode: "dispatch.rules.denied",
        sourceEventId: "evt-8b",
        status: "blocked",
        targetProfileId: "agt-target",
        ruleSource: "space",
        ruleId: "space.owner_only.v1",
        ruleReason: "space only allows owner mentions",
      },
    ]);
  });

  it("builds normalized result envelope for each decision", () => {
    const decisions = planMentionDispatchDecisions({
      createDispatchId: () => "dispatch-1",
      resolveMentionTargetLabel: () => ({
        bindingState: "bound",
        enabled: true,
        targetProfileId: "agt-valid",
      }),
      senderProfileId: "agt-owner",
      sourceEventId: "evt-8",
      text: "hey @agt-valid(wake)",
    });
    const first = decisions[0];
    if (!first) {
      throw new Error("expected one mention decision");
    }

    const envelope = buildMentionDispatchResultEnvelope(first);
    expect(envelope).toEqual({
      v: 2,
      code: "service.mention_dispatch_result",
      payload: {
        sourceEventId: "evt-8",
        dispatchId: "dispatch-1",
        targetProfileId: "agt-valid",
        status: "dispatch_ready",
        ruleSource: "registry",
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    });
  });
});
