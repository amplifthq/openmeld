import {
  CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
  helloSchema,
  incomingServerMessageSchema,
  profileSchema,
  signalEnvelopeSchema,
  signalTextSchema,
} from "@openmeld/schemas/schemas";
import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_LENGTH,
  parseEnvelope,
  parseHello,
  parseIncoming,
  parseProfile,
  parseSignalText,
} from "../src";

describe("protocol parser parity with shared schemas", () => {
  it("keeps profile parsing behavior aligned", () => {
    const inputs: unknown[] = [
      {
        kind: "agent",
        profileId: "mira",
        profileHandle: "mira-agent",
        profileName: "Mira",
        owner: "Felix",
      },
      {
        kind: "unknown-kind",
        profileId: "fallback-agent",
        profileName: "Fallback",
      },
      {
        kind: "human",
        profileId: "alice",
        profileName: "Alice",
        owner: "ignored-owner-for-human",
      },
      {
        kind: "agent",
        profileId: "   ",
      },
      null,
      42,
    ];

    for (const input of inputs) {
      const legacy = parseProfile(input);
      const schema = profileSchema.safeParse(input);
      expect(legacy.ok).toBe(schema.success);

      if (legacy.ok && schema.success) {
        expect(legacy.value).toEqual(schema.data);
      }
    }
  });

  it("keeps hello parsing behavior aligned", () => {
    const inputs: unknown[] = [
      {
        type: "hello",
        profile: {
          kind: "agent",
          profileId: "mira",
          profileHandle: "mira-agent",
          profileName: "Mira",
          owner: "Felix",
        },
        capabilities: {
          liveSignalHistory: true,
        },
      },
      {
        type: "hello",
        profile: {
          profileId: "fallback-kind",
          kind: "invalid",
        },
      },
      {
        type: "hello",
      },
      {
        type: "signal.text",
        data: { text: "not hello" },
      },
    ];

    for (const input of inputs) {
      const legacy = parseHello(input as Record<string, unknown>);
      const schema = helloSchema.safeParse(input);
      expect(legacy.ok).toBe(schema.success);

      if (legacy.ok && schema.success) {
        expect(legacy.value).toEqual(schema.data);
      }
    }
  });

  it("keeps signal.text parsing behavior aligned", () => {
    const inputs: unknown[] = [
      {
        type: "signal.text",
        data: {
          text: "hello",
          meta: {
            purpose: "space_membership_join_notice",
            targetProfileId: "hum-helper-1",
            targetProfileKind: "human",
            targetMentionLabel: "Helper Human",
            addedByProfileId: "hum-host-1",
            addedByDisplayName: "Felix",
          },
        },
      },
      {
        type: "signal.text",
        data: {
          text: "thanks",
          replyTo: {
            signalId: " evt-source-1 ",
            profileId: "22222222-2222-4222-8222-222222222222",
            profileKind: "human",
            profileName: " Felix ",
            previewText: " can you review this? ",
          },
        },
      },
      {
        type: "signal.text",
        data: {
          text: "Runner replied.",
          meta: {
            coreReadinessFactsChanged: {
              agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
              kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
            },
          },
        },
      },
      {
        type: "signal.text",
        data: {
          text: "@Budget Analyst(wake) hello",
          messageEnvelope: {
            activationTargets: ["agt_55555555-5555-4555-8555-555555555555"],
            referenceTargets: [],
            text: "@Budget Analyst(wake) hello",
          },
        },
      },
      {
        type: "signal.text",
        data: {
          text: "preview text",
          meta: {
            transient: true,
            purpose: "agent_reply_preview",
            dispatchId: "dispatch-preview-1",
            targetProfileId: "agt-preview-1",
            targetProfileName: "Demo Bot",
          },
        },
      },
      {
        type: "signal.text",
        data: { text: "   trimmed   " },
      },
      {
        type: "signal.text",
        data: { text: " " },
      },
      {
        type: "signal.text",
        data: { text: "x".repeat(MAX_TEXT_LENGTH + 1) },
      },
      {
        type: "signal.text",
        data: {
          text: "hello",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            text: "different",
          },
        },
      },
      {
        type: "presence.join",
        data: {},
      },
    ];

    for (const input of inputs) {
      const legacy = parseSignalText(input as Record<string, unknown>);
      const schema = signalTextSchema.safeParse(input);
      expect(legacy.ok).toBe(schema.success);

      if (legacy.ok && schema.success) {
        expect(legacy.value).toEqual(schema.data);
      }
    }
  });

  it("keeps signal envelope parsing behavior aligned", () => {
    const inputs: unknown[] = [
      {
        v: 1,
        id: "evt-1",
        spaceId: "demo",
        ts: 1,
        profile: { kind: "agent", profileId: "mira" },
        type: "signal.text",
        data: {
          text: "hello",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            text: "hello",
          },
          replyTo: {
            signalId: " evt-source-2 ",
            profileId: "agt_55555555-5555-4555-8555-555555555555",
            profileKind: "agent",
            profileName: " Demo Bot ",
            previewText: " please inspect prod ",
          },
          meta: {
            transient: true,
            purpose: "agent_reply_preview",
            dispatchId: "dispatch-preview-1",
            targetProfileId: "agt-preview-1",
            targetProfileName: "Demo Bot",
          },
        },
      },
      {
        v: 1,
        id: "evt-2",
        spaceId: "demo",
        ts: 2,
        profile: { kind: "agent", profileId: "mira" },
        type: "presence.join",
        data: {},
      },
      {
        v: 1,
        id: "evt-status-1",
        spaceId: "demo",
        ts: 3,
        profile: { kind: "agent", profileId: "mira" },
        type: "signal.status",
        data: {
          actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
          status: "done",
          dispatchId: "dispatch-1",
          text: "Ready for the next step.",
          generatedBy: "openmeld",
        },
      },
      {
        v: 1,
        id: "evt-activity-1",
        spaceId: "demo",
        ts: 3,
        profile: { kind: "system", profileId: "openmeld.system.dispatch" },
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
          dispatchId: "dispatch-activity-1",
          reason: "Handled privately.",
          text: "Research Agent chose to stay silent: Handled privately.",
          generatedBy: "openmeld",
        },
      },
      {
        v: 1,
        id: "evt-legacy-notice",
        spaceId: "demo",
        ts: 4,
        profile: { kind: "human", profileId: "felix" },
        type: "signal.text",
        data: {
          text: "Felix added Helper to this space.",
          meta: {
            purpose: "space_membership_join_notice",
          },
        },
      },
      {
        v: 1,
        id: "evt-4",
        spaceId: "demo",
        ts: 5,
        profile: { kind: "agent", profileId: "mira" },
        type: "presence.join",
        data: [],
      },
      {
        v: 1,
        id: "evt-5",
        spaceId: "demo",
        ts: 6,
        profile: { kind: "human", profileId: "felix" },
        type: "signal.text",
        data: {
          text: "hello",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            text: "not-hello",
          },
        },
      },
      {
        v: 1,
        id: "evt-5",
        spaceId: "demo",
        ts: 6.5,
        profile: { kind: "agent", profileId: "mira" },
        type: "signal.text",
        data: { text: "hello" },
      },
    ];

    for (const input of inputs) {
      const legacy = parseEnvelope(input);
      const schema = signalEnvelopeSchema.safeParse(input);
      expect(legacy !== null).toBe(schema.success);

      if (legacy && schema.success) {
        expect(legacy).toEqual(schema.data);
      }
    }
  });

  it("keeps incoming server message parsing behavior aligned", () => {
    const inputs: unknown[] = [
      {
        v: 1,
        id: "evt-1",
        spaceId: "demo",
        ts: 1,
        profile: { kind: "agent", profileId: "mira" },
        type: "signal.text",
        data: { text: "hello" },
      },
      {
        v: 1,
        id: "evt-status-1",
        spaceId: "demo",
        ts: 2,
        profile: { kind: "agent", profileId: "mira" },
        type: "signal.status",
        data: {
          actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
          status: "done",
          dispatchId: "dispatch-1",
          text: "Ready for the next step.",
          generatedBy: "openmeld",
        },
      },
      {
        type: "system.hello.ack",
        profile: { kind: "agent", profileId: "mira" },
      },
      {
        type: "system.hello.ack",
        profile: { kind: "agent", profileId: " " },
      },
      {
        type: "space.members.changed",
        spaceId: "demo",
        version: 101,
        profileIds: ["profile-1"],
        reason: "space.members.added",
      },
      {
        // Protocol-level parseIncoming accepts server error frames; only the CLI wrapper filters them out.
        error: "internal_error",
        requestId: "req-1",
        clientMessageId: "client-1",
      },
      {
        type: "unknown.type",
      },
    ];

    for (const input of inputs) {
      const legacy = parseIncoming(input);
      const schema = incomingServerMessageSchema.safeParse(input);
      expect(legacy !== null).toBe(schema.success);

      if (legacy && schema.success) {
        expect(legacy).toEqual(schema.data);
      }
    }
  });
});
