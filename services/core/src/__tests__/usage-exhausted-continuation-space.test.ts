import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import { describe, expect, it, vi } from "vitest";
import type {
  StartUsageExhaustedContinuationInput,
  StartUsageExhaustedContinuationResponse,
} from "../rpc/methods";
import { Space } from "../space/transport/do/space";

const SPACE_ID = "a".repeat(64);
const TARGET_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const REFERENCE_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const SOURCE_SIGNAL_ID = "signal-interrupted";
const INTERRUPTED_CLIENT_MESSAGE_ID = "client-interrupted";
const CONTINUATION_CLIENT_MESSAGE_ID =
  "agent-profile-work-continuation-5da1ee755432c68f046b7b774852d3f589118fa5c83839da03807fdde2423430";

describe("Usage-exhausted Space continuation", () => {
  it("replays the frozen Wake, files, and Agent References through one deterministic exactly-once writer identity", async () => {
    const posts: Record<string, unknown>[] = [];
    const persistedClientMessageIds = new Set<string>();
    let createdSignalCount = 0;
    const sourceSignal = {
      data: {
        files: [
          {
            fileId: "file-1",
            mimeType: "application/pdf",
            name: "brief.pdf",
            revision: 3,
            sizeBytes: 128,
          },
        ],
        messageEnvelope: {
          activationTargets: [TARGET_PROFILE_ID],
          referenceTargets: [REFERENCE_PROFILE_ID],
          text: "Finish the original task",
        },
        meta: { clientMessageId: INTERRUPTED_CLIENT_MESSAGE_ID },
        text: "Finish the original task",
      },
      id: SOURCE_SIGNAL_ID,
      profile: {
        kind: "human" as const,
        profileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Mira",
      },
      spaceId: SPACE_ID,
      ts: 1,
      type: "signal.text" as const,
      v: 1 as const,
    };
    const space = Object.create(
      Space.prototype
    ) as unknown as UsageContinuationSpaceHarness;
    space.spaceId = SPACE_ID;
    space.ctx = {
      storage: {
        sql: {
          exec: () => ({ toArray: () => [] }),
        },
      },
    };
    space.applySpaceRef = vi.fn();
    space.readSourceTextSignalById = vi.fn(() => sourceSignal);
    space.rpcGetDispatchTrace = vi.fn(async () => ({
      trace: {
        dispatch: {
          dispatchId: "dispatch-interrupted",
          sourceEventId: SOURCE_SIGNAL_ID,
          targetProfileId: TARGET_PROFILE_ID,
        },
      },
    }));
    space.rpcPostSignalOnceByClientMessageId = vi.fn(
      (post: Record<string, unknown>) => {
        posts.push(post);
        const clientMessageId = String(post.clientMessageId);
        if (!persistedClientMessageIds.has(clientMessageId)) {
          persistedClientMessageIds.add(clientMessageId);
          createdSignalCount += 1;
        }
        return Promise.resolve(sourceSignal);
      }
    );
    const input = continuationInput();

    await expect(
      space.rpcStartUsageExhaustedContinuation(input)
    ).resolves.toEqual({
      continuationClientMessageId: CONTINUATION_CLIENT_MESSAGE_ID,
      operationId:
        "agent-profile-work-continuation:5da1ee755432c68f046b7b774852d3f589118fa5c83839da03807fdde2423430",
      status: "started",
    });
    await expect(
      space.rpcStartUsageExhaustedContinuation(input)
    ).resolves.toEqual(expect.objectContaining({ status: "started" }));

    expect(posts).toHaveLength(2);
    expect(createdSignalCount).toBe(1);
    expect(posts[0]).toEqual(posts[1]);
    expect(posts[0]).toMatchObject({
      authoringPolicy: "user_authored",
      clientMessageId: CONTINUATION_CLIENT_MESSAGE_ID,
      files: sourceSignal.data.files,
      messageEnvelope: {
        activationTargets: [TARGET_PROFILE_ID],
        referenceTargets: [REFERENCE_PROFILE_ID],
        text: "Finish the original task",
      },
      meta: { clientMessageId: CONTINUATION_CLIENT_MESSAGE_ID },
      profile: sourceSignal.profile,
      spaceAccess: {
        actor: {
          dispatchId: "dispatch-interrupted",
          kind: "dispatch_continuation",
          requestContext: {
            actorContext: {
              openMeldProfileId: sourceSignal.profile.profileId,
              profileKind: "human",
              profileName: "Mira",
              requestId: "usage-continuation:dispatch-interrupted",
            },
          },
          sourceSignalId: SOURCE_SIGNAL_ID,
          targetProfileId: TARGET_PROFILE_ID,
        },
      },
      text: "Finish the original task",
    });
  });
});

function continuationInput(): StartUsageExhaustedContinuationInput {
  const context = {
    activeOrganizationId: "org-1",
    actorContext: {
      openMeldProfileId: "22222222-2222-4222-8222-222222222222",
      ownerUserId: "owner-1",
      profileKind: "human" as const,
      profileName: "Owner",
      requestId: "request-continuation",
    },
  };
  return {
    context,
    continuationClientMessageId: CONTINUATION_CLIENT_MESSAGE_ID,
    interruptedClientMessageId: INTERRUPTED_CLIENT_MESSAGE_ID,
    interruptedDispatchId: "dispatch-interrupted",
    interruptedSourceSignalId: SOURCE_SIGNAL_ID,
    operationId:
      "agent-profile-work-continuation:5da1ee755432c68f046b7b774852d3f589118fa5c83839da03807fdde2423430",
    spaceAccess: createDispatchContinuationSpaceAccessContext({
      dispatchId: "dispatch-interrupted",
      requestContext: context,
      sourceSignalId: SOURCE_SIGNAL_ID,
      spaceId: SPACE_ID,
      targetProfileId: TARGET_PROFILE_ID,
    }),
    spaceId: SPACE_ID,
    targetProfileId: TARGET_PROFILE_ID,
  };
}

type UsageContinuationSpaceHarness = {
  applySpaceRef: ReturnType<typeof vi.fn>;
  ctx: {
    storage: {
      sql: {
        exec: () => { toArray: () => unknown[] };
      };
    };
  };
  readSourceTextSignalById: ReturnType<typeof vi.fn>;
  rpcGetDispatchTrace: ReturnType<typeof vi.fn>;
  rpcPostSignalOnceByClientMessageId: ReturnType<typeof vi.fn>;
  rpcStartUsageExhaustedContinuation: (
    input: StartUsageExhaustedContinuationInput
  ) => Promise<StartUsageExhaustedContinuationResponse>;
  spaceId: string;
};
