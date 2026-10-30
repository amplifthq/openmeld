import { buildSpaceMessageEvidence } from "@openmeld/protocol";
import type {
  RemoteAgentTurnEnvelope,
  SignalEnvelope,
} from "@openmeld/schemas/types";
import { buildRemoteAgentSystemPrompt } from "../../../remote-agent/agent-core/prompt";
import { renderRemoteAgentTurnEnvelope } from "../../../remote-agent/agent-core/turn-envelope";
import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
  buildCenterAgentSpaceMemoryRef,
  type CenterAgentMemoryAdapter,
  type CenterAgentMemoryEpisodeOrigin,
  type CenterAgentMemoryRef,
  type CenterAgentMemoryRepository,
  type CenterAgentMemorySearchResult,
} from "../../src/center-agent-memory/contract";
import { createCenterAgentMemoryService } from "../../src/center-agent-memory/memory-service";
import { resolveMemorySourceExcerpt } from "../../src/center-agent-memory/source-excerpt";
import type { CoreBindings } from "../../src/lib/bindings";
import { attachCenterAgentMemoryToTurnEnvelope } from "../../src/remote-agent/application/remote-agent-memory-context";
import type { MemoryBaselineCase } from "./cases";

export const REPLAY_TIME = Date.UTC(2026, 9, 1, 12);
const speakerMember = { memberId: "fixture-member", userId: "fixture-user" };
const speakerProfileId = "11111111-1111-4111-8111-111111111111";

/** No database, production subject, or user state is accessed by this repository. */
export function createReplayRepository(organizationId: string) {
  const active = new Map<string, CenterAgentMemoryRef>();
  const erased = new Set<string>();
  const repository: CenterAgentMemoryRepository = {
    readActiveSubjects: async (value) =>
      [...active.values()]
        .filter(
          (ref) =>
            value.organizationId === organizationId &&
            (ref.subject.kind !== "space" ||
              ref.subject.spaceId === value.spaceId)
        )
        .map((ref) => ({ ...ref, updatedAtMs: REPLAY_TIME })),
    upsertSpaceSubject: (value) => {
      const ref = buildCenterAgentSpaceMemoryRef(value);
      if (erased.has(ref.subjectId)) {
        return Promise.reject(new Error("Space memory was erased"));
      }
      active.set(ref.subjectId, ref);
      return Promise.resolve(ref);
    },
    beginSpaceDeletion: (value) => {
      const id = buildCenterAgentSpaceMemoryRef(value).subjectId;
      erased.add(id);
      active.delete(id);
      return Promise.resolve();
    },
    isSpaceSubjectActive: async (value) =>
      active.has(buildCenterAgentSpaceMemoryRef(value).subjectId),
    markSpaceDeleted: async (value) =>
      active.delete(buildCenterAgentSpaceMemoryRef(value).subjectId),
    markSpaceDeleteFailed: (value) => {
      active.delete(buildCenterAgentSpaceMemoryRef(value).subjectId);
      return Promise.resolve();
    },
    readPolicy: async () => ({
      organizationMemoryOptIn: true,
      updatedByUserId: null,
    }),
    upsertOrganizationSubject: () => {
      const ref = buildCenterAgentOrganizationMemoryRef({ organizationId });
      active.set(ref.subjectId, ref);
      return Promise.resolve(ref);
    },
    upsertMemberSubject: () => {
      const ref = buildCenterAgentMemberMemoryRef({
        organizationId,
        ...speakerMember,
      });
      active.set(ref.subjectId, ref);
      return Promise.resolve(ref);
    },
    markMemberDeleted: async () => false,
    markOrganizationDeleted: async () => false,
    markMemberDeleteFailed: async () => undefined,
    markOrganizationDeleteFailed: async () => undefined,
    upsertPolicy: () =>
      Promise.reject(new Error("Evaluation must not change policy")),
  };
  return { repository, active };
}

export function createReplayEnvelope(
  organizationId: string
): RemoteAgentTurnEnvelope {
  return {
    sender: {
      kind: "member",
      id: speakerMember.memberId,
      displayName: "Fixture member",
      ownerUserId: speakerMember.userId,
      profileId: speakerProfileId,
      role: "owner",
      verified: true,
    },
    space: {
      id: "fixture-space",
      name: "Cedar Issues",
      kind: "space",
      isCenterAgentDm: false,
    },
    organization: {
      id: organizationId,
      name: "Cedar",
      personal: false,
      memberCount: 3,
    },
    centerAgent: { profileName: "Center Agent", profileHandle: "center-agent" },
    trigger: { source: "space_wake" },
    interactionEnvironment: "organization_shared",
  };
}

export function createReplay(
  caseId: string,
  adapter: CenterAgentMemoryAdapter
) {
  const { repository, active } = createReplayRepository(caseId);
  const writes: {
    input: Parameters<CenterAgentMemoryAdapter["addEpisode"]>[0];
    receipt?: Awaited<ReturnType<CenterAgentMemoryAdapter["addEpisode"]>>;
  }[] = [];
  const searches: {
    query: string;
    elapsedMs: number;
    items?: CenterAgentMemorySearchResult[];
    error?: string;
  }[] = [];
  const warnings: unknown[][] = [];
  const sources = new Map<
    string,
    Extract<SignalEnvelope, { type: "signal.text" }>
  >();
  const saveValidation: { status: "accepted" | "rejected"; reason?: string }[] =
    [];
  const background: Promise<unknown>[] = [];
  const observedAdapter: CenterAgentMemoryAdapter = {
    ...adapter,
    addEpisode: async (input) => {
      const write: (typeof writes)[number] = { input };
      writes.push(write);
      write.receipt = await adapter.addEpisode(input);
      return write.receipt;
    },
    search: async (input) => {
      const started = performance.now();
      const row: (typeof searches)[number] = {
        query: input.query,
        elapsedMs: 0,
      };
      searches.push(row);
      try {
        row.items = await adapter.search(input);
        return row.items;
      } catch (error) {
        row.error = error instanceof Error ? error.name : "UnknownError";
        throw error;
      } finally {
        row.elapsedMs = Math.round(performance.now() - started);
      }
    },
  };
  const service = createCenterAgentMemoryService({
    adapter: observedAdapter,
    repository,
    nowMs: () => REPLAY_TIME,
    logger: { warn: (...args) => warnings.push(args) },
    waitUntil: (promise) => {
      background.push(promise);
    },
    spaceAccess: {
      canRead: async (input) =>
        input.organizationId === caseId &&
        input.spaceId === "fixture-space" &&
        input.speakerMember.userId === speakerMember.userId,
      readSource: async (input) => {
        const source = sources.get(input.signalId);
        if (
          input.organizationId !== caseId ||
          input.spaceId !== "fixture-space" ||
          !source
        ) {
          return null;
        }
        const evidence = await buildSpaceMessageEvidence({
          signal: source,
          spaceId: "fixture-space",
        });
        return {
          text: source.data.text,
          version: evidence.message.sourceRef.version,
          occurredAtMs: source.ts,
          author: evidence.message.author,
        };
      },
    },
  });
  const queries: string[] = [];
  const observedService = {
    ...service,
    recallForTurn: (input: Parameters<typeof service.recallForTurn>[0]) => {
      queries.push(input.query);
      return service.recallForTurn(input);
    },
    recallForOrganization: (
      input: Parameters<typeof service.recallForOrganization>[0]
    ) => {
      queries.push(input.query);
      return service.recallForOrganization(input);
    },
  };
  return {
    active,
    writes,
    searches,
    warnings,
    queries,
    service,
    repository,
    saveValidation,
    background,
    async capture(seed: MemoryBaselineCase) {
      for (const [index, turn] of seed.turns.entries()) {
        sources.set(
          `fixture-${index}`,
          sourceMessage(
            `fixture-${index}`,
            turn.user,
            REPLAY_TIME + index * 60_000
          )
        );
        await service.rememberTurn({
          organizationId: caseId,
          speakerMember,
          interactionEnvironment: "organization_shared",
          source: "space_conversation",
          sourceConversationId: "fixture-space",
          sourceMessageId: `fixture-${index}`,
          occurredAtMs: REPLAY_TIME + index * 60_000,
          userMessage: turn.user,
          assistantMessage: turn.assistant,
        });
      }
      if (seed.explicitSave) {
        const signalId = seed.turns.length
          ? `fixture-${seed.turns.length - 1}`
          : "fixture-save-source";
        if (!sources.has(signalId)) {
          sources.set(
            signalId,
            sourceMessage(signalId, seed.explicitSave, REPLAY_TIME)
          );
        }
        const source = sources.get(signalId);
        if (!source) {
          throw new Error("Missing source fixture");
        }
        const evidence = await buildSpaceMessageEvidence({
          signal: source,
          spaceId: "fixture-space",
        });
        let origin: CenterAgentMemoryEpisodeOrigin;
        try {
          origin = await resolveMemorySourceExcerpt({
            fact: seed.explicitSave,
            origin: {
              source: "space_conversation",
              sourceConversationId: "fixture-space",
              sourceMessageId: "fixture-save",
              occurredAtMs: REPLAY_TIME + 600_000,
            },
            sourceRef: {
              kind: "message",
              spaceId: "fixture-space",
              sourceSignalId: signalId,
              version: evidence.message.sourceRef.version,
            },
            readSource: async (id) => sources.get(id) ?? null,
          });
          saveValidation.push({ status: "accepted" });
        } catch (error) {
          saveValidation.push({
            status: "rejected",
            reason: error instanceof Error ? error.message : "UnknownError",
          });
          return;
        }
        await service.rememberFactForOrganization({
          organizationId: caseId,
          speakerMember,
          fact: seed.explicitSave,
          origin,
        });
      }
    },
    attach(query: string) {
      return attachCenterAgentMemoryToTurnEnvelope({
        env: {} as CoreBindings,
        organizationId: caseId,
        query,
        memoryService: observedService,
        turnEnvelope: createReplayEnvelope(caseId),
      });
    },
  };
}

function sourceMessage(
  id: string,
  text: string,
  ts: number
): Extract<SignalEnvelope, { type: "signal.text" }> {
  return {
    v: 1,
    id,
    ts,
    spaceId: "fixture-space",
    type: "signal.text",
    profile: {
      kind: "human",
      profileId: speakerProfileId,
      profileName: "Fixture member",
    },
    data: { text, meta: { messageRevision: 0 } },
  };
}

/** Transport stub only: deliberately does not simulate semantic extraction/search. */
export function createOfflineAdapter(): CenterAgentMemoryAdapter {
  return {
    addEpisode: async () => ({
      episodeId: "offline-receipt",
      processed: false,
    }),
    ensureMemberUser: async () => undefined,
    ensureOrganizationGraph: async () => undefined,
    deleteMemberUser: async () => "not_found",
    deleteOrganizationGraph: async () => "not_found",
    search: async () => [],
  };
}

export async function projectVerifiedCandidates(texts: string[]) {
  const adapter = createOfflineAdapter();
  adapter.search = async () =>
    texts.map((text, index) => ({
      captureMethod: "explicit_save",
      occurredAtMs: REPLAY_TIME,
      source: "space_conversation",
      sourceConversationId: "fixture-space",
      sourceMessageId: `fixture-${index}`,
      subject: "organization",
      text,
    }));
  const replay = createReplay("fixture-projection", adapter);
  await replay.repository.upsertOrganizationSubject({
    organizationId: "fixture-projection",
    nowMs: REPLAY_TIME,
  });
  return await replay.attach("What is the current rule?");
}

export function buildProbeMessages(
  seed: MemoryBaselineCase,
  envelope: RemoteAgentTurnEnvelope,
  arm: "no_memory" | "current_pipeline" | "verified_context"
) {
  const selected = {
    ...envelope,
    memory: arm === "current_pipeline" ? envelope.memory : undefined,
  };
  return [
    {
      role: "system",
      content: buildRemoteAgentSystemPrompt({ turnEnvelope: selected }),
    },
    {
      role: "user",
      content: [
        renderRemoteAgentTurnEnvelope(selected),
        `Current request: ${seed.query}`,
        seed.currentEvidence,
        arm === "verified_context"
          ? `Manually verified reference evidence (evaluation intervention):\n${seed.verifiedContext}`
          : "",
        "Answer this bounded read-only evaluation question using the available evidence. No tools are available. Return JSON only.",
        seed.question,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

export function scoreProbeAnswer(
  answer: string | undefined,
  expected: MemoryBaselineCase["expected"]
) {
  if (answer === undefined) {
    return { status: "not_run" as const, mismatches: [] as string[] };
  }
  try {
    const parsed = JSON.parse(
      answer.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Not an object");
    }
    const mismatches = Object.entries(expected)
      .filter(([key, value]) => parsed[key] !== value)
      .map(([key]) => key);
    return {
      status: mismatches.length ? ("incorrect" as const) : ("correct" as const),
      mismatches,
    };
  } catch {
    return {
      status: "invalid_response" as const,
      mismatches: Object.keys(expected),
    };
  }
}
