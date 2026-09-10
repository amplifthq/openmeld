import type {
  SignalEnvelope,
  SpaceMessageReactions,
} from "@openmeld/schemas/types";
import { buildSignalMessageReadProjection } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import { buildCenterAgentContextMessageProjection } from "../src/center-agent/application/center-agent-context-manifest-service";

const reactions: SpaceMessageReactions = {
  version: 1,
  groups: [
    {
      emoji: "👍️",
      label: "thumbs up",
      count: 1,
      reactedByMe: false,
      actors: [
        { profileId: "alex", displayName: "Alex", profileKind: "human" },
      ],
      actorsHasMore: false,
    },
  ],
};
const signal: SignalEnvelope = {
  v: 1,
  id: "message-1",
  spaceId: "space-1",
  ts: 1000,
  type: "signal.text",
  profile: { kind: "human", profileId: "sam", profileName: "Sam" },
  data: { text: "The draft is ready." },
  reactions,
};
describe("Message reaction read contract", () => {
  it("keeps reaction identities separate from the original message in the shared CLI/Web projection", () => {
    const projection = buildSignalMessageReadProjection({ signal });
    expect(projection.reactions).toEqual(reactions);
    expect(projection.text).toBe("The draft is ready.");
  });
  it("changes the Agent source and materialization hashes when reactions change", async () => {
    const read = (version: number) =>
      buildCenterAgentContextMessageProjection({
        spaceId: "space-1",
        signals: [
          {
            ...signal,
            reactions: {
              ...reactions,
              version,
              groups: version === 1 ? reactions.groups : [],
            },
          },
        ],
        limit: 10,
        maxContextTokens: 8000,
        hasOlderMessages: false,
      });
    const added = await read(1),
      removed = await read(2);
    expect(added.entries[0]?.reactions).toEqual(reactions);
    expect(removed.entries[0]?.reactions).toEqual({ version: 2, groups: [] });
    expect(added.entries[0]?.sourceRef.version).not.toBe(
      removed.entries[0]?.sourceRef.version
    );
    expect(added.entries[0]?.materializedContentHash).not.toBe(
      removed.entries[0]?.materializedContentHash
    );
    expect(added.entries[0]?.content.text).toBe(
      removed.entries[0]?.content.text
    );
    expect(added.entries[0]?.occurredAt).toBe(removed.entries[0]?.occurredAt);
  });
});
