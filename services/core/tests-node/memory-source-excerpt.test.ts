import { buildSpaceMessageEvidence } from "@openmeld/protocol";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { expect, it, vi } from "vitest";
import { resolveMemorySourceExcerpt } from "../src/center-agent-memory/source-excerpt";

const source: Extract<SignalEnvelope, { type: "signal.text" }> = {
  v: 1,
  id: "source-rule",
  ts: 1000,
  type: "signal.text",
  spaceId: "space-1",
  profile: {
    kind: "human",
    profileId: "11111111-1111-4111-8111-111111111111",
    profileName: "Member",
  },
  data: {
    text: "For explicit build requests, create the issue then build it yourself. Human PR review is still required.",
    meta: { messageRevision: 0 },
  },
};
const origin = {
  source: "space_conversation" as const,
  sourceConversationId: "space-1",
  sourceMessageId: "later-save",
  occurredAtMs: 2000,
};

it("preserves the original statement and date rather than promoting a later Agent summary", async () => {
  const evidence = await buildSpaceMessageEvidence({
    signal: source,
    spaceId: source.spaceId,
  });
  const sourceRef = {
    kind: "message" as const,
    spaceId: source.spaceId,
    sourceSignalId: source.id,
    version: evidence.message.sourceRef.version,
  };
  const readSource = vi.fn(async () => source);
  const input = { origin, sourceRef, readSource, fact: source.data.text };
  await expect(resolveMemorySourceExcerpt(input)).resolves.toEqual({
    ...origin,
    sourceMessageId: source.id,
    occurredAtMs: source.ts,
    sourceVersion: sourceRef.version,
    sourceAuthorKind: "human",
  });
  await expect(
    resolveMemorySourceExcerpt({
      ...input,
      fact: "Build permission is still pending.",
    })
  ).rejects.toThrow("exact excerpt");
  await expect(
    resolveMemorySourceExcerpt({ ...input, sourceRef: undefined })
  ).rejects.toThrow("original message");
  await expect(
    resolveMemorySourceExcerpt({
      ...input,
      sourceRef: { ...sourceRef, spaceId: "another-space" },
    })
  ).rejects.toThrow("original message");
  await expect(
    resolveMemorySourceExcerpt({
      ...input,
      readSource: async () => ({
        ...source,
        data: {
          ...source.data,
          text: "The rule was replaced.",
          meta: { messageRevision: 1 },
        },
      }),
    })
  ).rejects.toThrow("changed");
  const edited = {
    ...source,
    data: {
      text: "The rule was replaced.",
      meta: { messageRevision: 1, editedAt: 3000 },
    },
  };
  const editedEvidence = await buildSpaceMessageEvidence({
    signal: edited,
    spaceId: edited.spaceId,
  });
  await expect(
    resolveMemorySourceExcerpt({
      ...input,
      fact: edited.data.text,
      sourceRef: {
        ...sourceRef,
        version: editedEvidence.message.sourceRef.version,
      },
      readSource: async () => edited,
    })
  ).resolves.toMatchObject({
    occurredAtMs: 3000,
    sourceVersion: editedEvidence.message.sourceRef.version,
  });
  const agentSource = {
    ...source,
    profile: {
      kind: "agent" as const,
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileName: "Agent",
    },
  };
  const agentEvidence = await buildSpaceMessageEvidence({
    signal: agentSource,
    spaceId: source.spaceId,
  });
  await expect(
    resolveMemorySourceExcerpt({
      ...input,
      sourceRef: {
        ...sourceRef,
        version: agentEvidence.message.sourceRef.version,
      },
      readSource: async () => agentSource,
    })
  ).resolves.toMatchObject({ sourceAuthorKind: "agent" });
  await expect(
    resolveMemorySourceExcerpt({ ...input, readSource: async () => null })
  ).rejects.toThrow("no longer available");
  await expect(
    resolveMemorySourceExcerpt({
      ...input,
      readSource: () => Promise.reject(new Error("access revoked")),
    })
  ).rejects.toThrow("access revoked");
});
