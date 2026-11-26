import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { expect, it, vi } from "vitest";
import {
  collectOwnerDirectMessageWorkCounterpartContext,
  type WorkCounterpartOwnerDmFacts,
} from "../src/member-agent/application/work-counterpart-owner-dm";
import {
  type WorkCounterpartLearning,
  workCounterpartLearningDigest,
} from "../src/member-agent/application/work-counterpart-pilot";

const learning = {
  id: "review-head-policy",
  text: "Verify a hosted check on the exact candidate head before reporting it green.",
  proposedByUserId: "review-proposer",
  sources: [
    { id: "synthetic-review-result", kind: "verified_outcome", revision: "v1" },
    {
      id: "synthetic-review-policy",
      kind: "approved_document",
      revision: "v2",
    },
  ],
} as const satisfies WorkCounterpartLearning;
const selection = {
  organizationId: "fixture-openmeld",
  projectId: "fixture-engineering",
  ownerUserId: "fixture-owner",
  profileId: "fixture-codex",
  learningId: learning.id,
  learningDigest: workCounterpartLearningDigest(learning),
};

const { organizationId, projectId, ownerUserId, profileId } = selection;
const humanProfileId = "fixture-human";
const spaceId = "fixture-dm";
const sourceSignalId = "fixture-wake-message";

function localOwnerWake(): WorkCounterpartOwnerDmFacts {
  return {
    execution: {
      dispatchId: "fixture-wake",
      sourceSignalId,
      projectId,
      organizationId,
      spaceId,
      targetProfileId: profileId,
      requestChain: [
        { kind: "human", profileId: humanProfileId },
        { kind: "agent", profileId },
      ],
    },
    source: {
      signalId: sourceSignalId,
      profileId: humanProfileId,
      ownerUserId,
      kind: "human",
      recalled: false,
    },
    dm: {
      organizationId,
      spaceId,
      accessMode: "members_only",
      meta: {
        purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
        directMessage: {
          pairKey: [humanProfileId, profileId].sort().join(":"),
        },
      },
      members: [
        {
          status: "active",
          profileId: humanProfileId,
          profileKindSnapshot: "human",
          ownerUserIdSnapshot: ownerUserId,
        },
        {
          status: "active",
          profileId,
          profileKindSnapshot: "agent",
          ownerUserIdSnapshot: ownerUserId,
        },
      ],
    },
    directory: {
      ownerUserId,
      ownerHumanProfileId: humanProfileId,
      localCodexProfileId: profileId,
    },
    project: { organizationId, projectId, active: true },
  };
}

type Ports = Parameters<
  typeof collectOwnerDirectMessageWorkCounterpartContext
>[1];

function fakePorts(facts = localOwnerWake()) {
  return {
    readCurrentFacts: vi
      .fn<Ports["readCurrentFacts"]>()
      .mockResolvedValue(facts),
    readSelectedLearning: vi
      .fn<Ports["readSelectedLearning"]>()
      .mockResolvedValue(learning),
    readApproval: vi.fn<Ports["readApproval"]>().mockResolvedValue({
      candidateId: learning.id,
      digest: selection.learningDigest,
      verifiedByUserId: "independent-verifier",
      approvedByUserId: "human-approver",
      status: "approved",
    }),
    inspectSource: vi
      .fn<Ports["inspectSource"]>()
      .mockImplementation(async ({ ref }) => ({
        ...ref,
        organizationId,
        projectId,
        classification: "organization_managed",
        readableByAudience: true,
        authorPrincipalId: "verified-work-author",
      })),
    readSource: vi
      .fn<Ports["readSource"]>()
      .mockImplementation(async ({ ref }) => ref),
  } satisfies Ports;
}

it("does not touch execution, candidates or evidence without an exact configured cohort", async () => {
  const ports = fakePorts();
  await expect(
    collectOwnerDirectMessageWorkCounterpartContext({}, ports)
  ).resolves.toMatchObject({ status: "disabled", notes: [] });
  await expect(
    collectOwnerDirectMessageWorkCounterpartContext(
      { selection: { ...selection, learningDigest: "latest" } },
      ports
    )
  ).resolves.toMatchObject({ status: "denied", notes: [] });
  for (const port of Object.values(ports)) {
    expect(port).not.toHaveBeenCalled();
  }
});

it("projects the exact reviewed note for the owner of both participants", async () => {
  const ports = fakePorts();
  await expect(
    collectOwnerDirectMessageWorkCounterpartContext({ selection }, ports)
  ).resolves.toEqual({
    status: "ready",
    notes: [
      { id: learning.id, text: learning.text, sources: learning.sources },
    ],
    omitted: 0,
  });
  expect(ports.readSelectedLearning).toHaveBeenCalledExactlyOnceWith({
    scope: {
      organizationId,
      projectId,
      profileId,
      requesterUserId: ownerUserId,
      audienceUserIds: [ownerUserId],
    },
    id: learning.id,
    digest: selection.learningDigest,
  });
});

it.each<{
  label: string;
  change(facts: WorkCounterpartOwnerDmFacts): void;
}>([
  {
    label: "a colleague's Agent",
    change(facts) {
      facts.directory.ownerUserId = "other-owner";
    },
  },
  {
    label: "an owner observer",
    change(facts) {
      facts.dm.members = facts.dm.members.filter(
        (member) => member.profileId === profileId
      );
    },
  },
  {
    label: "an ordinary Space",
    change(facts) {
      facts.dm.meta = { purpose: "team_space" };
    },
  },
  {
    label: "a converted DM",
    change(facts) {
      facts.dm.meta = {
        ...facts.dm.meta,
        directMessage: {
          pairKey: [humanProfileId, profileId].sort().join(":"),
          convertedAt: "2026-11-26T00:00:00Z",
        },
      };
    },
  },
  {
    label: "a third active profile",
    change(facts) {
      facts.dm.members = [
        ...facts.dm.members,
        {
          profileId: "third-profile",
          profileKindSnapshot: "human",
          status: "active",
          ownerUserIdSnapshot: ownerUserId,
        },
      ];
    },
  },
  {
    label: "a delegated Wake",
    change(facts) {
      facts.execution.requestChain.splice(1, 0, {
        kind: "agent",
        profileId: "delegator",
      });
    },
  },
  {
    label: "a Routine Wake",
    change(facts) {
      facts.execution.requestChain.splice(1, 0, {
        kind: "source",
        source: "routine",
        sourceId: "nightly",
      });
    },
  },
  {
    label: "a recalled message",
    change(facts) {
      facts.source.recalled = true;
    },
  },
  {
    label: "another active Project",
    change(facts) {
      facts.execution.projectId = "other-project";
    },
  },
  {
    label: "an archived Project",
    change(facts) {
      facts.project.active = false;
    },
  },
  {
    label: "another Organization",
    change(facts) {
      facts.project.organizationId = "another-org";
    },
  },
])("does not even request the selected note for $label", async ({ change }) => {
  const facts = localOwnerWake();
  change(facts);
  const ports = fakePorts(facts);
  await expect(
    collectOwnerDirectMessageWorkCounterpartContext({ selection }, ports)
  ).resolves.toMatchObject({ status: "denied", notes: [] });
  expect(ports.readSelectedLearning).not.toHaveBeenCalled();
  expect(ports.readApproval).not.toHaveBeenCalled();
  expect(ports.inspectSource).not.toHaveBeenCalled();
  expect(ports.readSource).not.toHaveBeenCalled();
});

it("does not replace the configured digest with a different approved summary", async () => {
  const ports = fakePorts();
  ports.readSelectedLearning.mockResolvedValue({
    ...learning,
    text: "Different body.",
  });
  await expect(
    collectOwnerDirectMessageWorkCounterpartContext({ selection }, ports)
  ).resolves.toMatchObject({ status: "ready", notes: [] });
  expect(ports.readApproval).not.toHaveBeenCalled();
  expect(ports.readSource).not.toHaveBeenCalled();
});

it("checks the initial source and current audience again before reading any source", async () => {
  const ports = fakePorts();
  const differentWake = localOwnerWake();
  differentWake.execution.dispatchId = "another-dispatch";
  ports.readCurrentFacts
    .mockResolvedValueOnce(localOwnerWake())
    .mockResolvedValueOnce(localOwnerWake())
    .mockResolvedValue(differentWake);
  await expect(
    collectOwnerDirectMessageWorkCounterpartContext({ selection }, ports)
  ).resolves.toMatchObject({ status: "denied", notes: [] });
  expect(ports.readSource).not.toHaveBeenCalled();
});

it("drops a previously readable source revoked while assembling the note", async () => {
  const ports = fakePorts();
  const inspect = ports.inspectSource.getMockImplementation();
  let revoked = false;
  ports.readSource.mockImplementation(({ ref }) => {
    revoked = true;
    return Promise.resolve(ref);
  });
  ports.inspectSource.mockImplementation(async (input) =>
    revoked ? null : (inspect?.(input) ?? null)
  );
  await expect(
    collectOwnerDirectMessageWorkCounterpartContext({ selection }, ports)
  ).resolves.toMatchObject({ status: "ready", notes: [], omitted: 1 });
});

it("does not return the selected note if the DM converts after the exact source read", async () => {
  const active = localOwnerWake();
  const converted = localOwnerWake();
  const pair = converted.dm.meta?.directMessage;
  if (!pair) {
    throw new Error("Invalid fixture");
  }
  pair.convertedAt = "2026-11-26T00:00:00Z";
  const ports = fakePorts(active);
  ports.readSource.mockImplementation(({ ref }) => {
    ports.readCurrentFacts.mockResolvedValue(converted);
    return Promise.resolve(ref);
  });
  await expect(
    collectOwnerDirectMessageWorkCounterpartContext({ selection }, ports)
  ).resolves.toMatchObject({ status: "denied", notes: [] });
  expect(ports.readSource).toHaveBeenCalled();
});
