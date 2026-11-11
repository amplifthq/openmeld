import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
  spaceMemberDirectorySchema,
  spaceMentionLabelSourceSchema,
} from "@openmeld/schemas";
import type { SpaceMeta } from "@openmeld/schemas/types";
import { expect, it, vi } from "vitest";
import { ensurePrimaryAgentProfileBindingRecord } from "../../core/src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { centerAgentReadSpaceGuide } from "../../core/src/center-agent/application/space-guide";
import type { CoreBindings } from "../../core/src/lib/bindings";
import { createCoreRpcHttpError } from "../../core/src/rpc/errors";
import type { GetSpaceMetaInput } from "../../core/src/rpc/methods";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import {
  createEvidenceFixture,
  EVIDENCE_SPACE_ID,
} from "./center-agent-evidence.test-support";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";

it("reads the current owning Guide rather than an old claim, and keeps denied or mismatched sources distinct from an empty Guide", async () => {
  const base = createSubmitTurnRequest();
  const f = await createEvidenceFixture({
    request: {
      ...base,
      spaceId: EVIDENCE_SPACE_ID,
      turnEnvelope: {
        ...base.turnEnvelope,
        space: {
          ...base.turnEnvelope.space,
          id: EVIDENCE_SPACE_ID,
          guide: "An old Agent claimed a five-item cap.",
        },
      },
    },
  });
  const original = f.spaces.get(f.request.spaceId);
  if (!original) {
    throw new Error("Missing source fixture");
  }
  await ensurePrimaryAgentProfileBindingRecord({
    db: f.harness.db,
    record: {
      agentProfileId: f.request.agentProfileId,
      bindingId: f.request.bindingId,
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      runtimeKind: "hosted_center_agent",
      hostedRuntimeIdentityJson: JSON.stringify(
        HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
      ),
      owner: { kind: "organization", id: f.request.organizationId },
      createdAtMs: TEST_NOW_MS,
      updatedAtMs: TEST_NOW_MS,
    },
  });
  const directory = spaceMemberDirectorySchema.parse({
    spaceId: f.request.spaceId,
    generatedAt: new Date(TEST_NOW_MS).toISOString(),
    members: [f.request.agentProfileId, f.speaker.profileId].map(
      (profileId, index) => ({
        profileId,
        profileKind: index === 0 ? "agent" : "human",
        displayName: index === 0 ? "Center" : "Member",
        primaryMentionLabel: profileId,
        mentionLabels: [profileId],
        mentionAlias: null,
        labelSource: spaceMentionLabelSourceSchema.options[0],
        lookupTokens: [profileId],
        preferredLookupToken: profileId,
        profileIdShort: profileId.slice(0, 12),
        allowedRelations: {
          wake: index === 0,
          reference: index === 0,
          mention: index !== 0,
        },
        ownerUserId: index === 0 ? null : f.speaker.ownerUserId,
        ownerName: null,
        agentCard: null,
        spaceRole: null,
      })
    ),
  });
  let meta: SpaceMeta = {
    ...original,
    guide: "Use the currently published routing decision.",
  };
  const readMeta = vi.fn((_request: GetSpaceMetaInput) =>
    Promise.resolve(meta)
  );
  const readSpaces: string[] = [];
  const env = {
    ...f.env,
    OPENMELD_SPACES: {
      idFromString: (id: string) => id,
      get: (id: string) => {
        readSpaces.push(id);
        return {
          rpcGetMeta: readMeta,
          rpcGetMemberDirectory: () => Promise.resolve(directory),
        };
      },
    },
  } as unknown as CoreBindings;
  const coreWorker = {
    centerAgentReadSpaceGuide: (value: unknown) =>
      centerAgentReadSpaceGuide(env, value),
  };
  const current = await f.execute(coreWorker, "openmeld_read_space_guide");
  expect(current).toMatchObject({
    guide: meta.guide,
    sourceRef: {
      kind: "space_guide",
      state: "current",
      spaceId: f.request.spaceId,
    },
  });
  expect(JSON.stringify(current)).not.toContain("five-item cap");
  meta = { ...original };
  expect(await f.execute(coreWorker, "openmeld_read_space_guide")).toEqual({
    guide: null,
    sourceRef: {
      kind: "space_guide",
      spaceId: f.request.spaceId,
      state: "current",
      version:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
  });
  meta = { ...original, spaceId: "b".repeat(64), guide: "A different Space" };
  await expect(
    f.execute(coreWorker, "openmeld_read_space_guide")
  ).rejects.toThrow("space.guide.invalid_source");
  const denied = createCoreRpcHttpError({
    status: 403,
    code: "space.membership_required",
    reason: "Source access was revoked.",
  });
  readMeta.mockRejectedValueOnce(denied);
  await expect(f.execute(coreWorker, "openmeld_read_space_guide")).rejects.toBe(
    denied
  );
  await expect(
    centerAgentReadSpaceGuide(env, {
      context: buildRemoteAgentCoreContext(f.callbackContext, "guide-scope"),
      spaceId: "b".repeat(64),
    })
  ).rejects.toThrow("space.guide.invalid_input");
  expect(readSpaces.every((spaceId) => spaceId === f.request.spaceId)).toBe(
    true
  );
});
