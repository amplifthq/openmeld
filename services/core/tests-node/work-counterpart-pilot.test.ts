import { expect, it, vi } from "vitest";
import { runWorkCounterpartPrReviewAcceptance } from "../evals/work-counterpart/pr-review-acceptance";
import {
  collectWorkCounterpartContext,
  proposeWorkCounterpartLearning,
  type WorkCounterpartLearning,
  type WorkCounterpartPorts,
  type WorkCounterpartScope,
  type WorkCounterpartSourceRef,
  workCounterpartLearningDigest,
} from "../src/member-agent/application/work-counterpart-pilot";

const scope: WorkCounterpartScope = {
  organizationId: "fictional-openmeld",
  projectId: "fictional-engineering",
  profileId: "existing-fixture-colleague",
  requesterUserId: "fixture-requester",
  audienceUserIds: ["fixture-requester", "fixture-reviewer"],
};
const outcome = {
  id: "fictional-outcome",
  kind: "verified_outcome",
  revision: "outcome-v1",
} as const satisfies WorkCounterpartSourceRef;
const approvedDocument = {
  id: "fictional-policy",
  kind: "approved_document",
  revision: "docs-v2",
} as const satisfies WorkCounterpartSourceRef;
const candidate = {
  id: "fictional-learning",
  proposedByUserId: "fixture-proposer",
  sources: [outcome, approvedDocument],
  text: "A hosted result must match the exact proposed head.",
} as const satisfies WorkCounterpartLearning;

function fakePorts() {
  return {
    authorizeScope: vi
      .fn<WorkCounterpartPorts["authorizeScope"]>()
      .mockResolvedValue(true),
    readApproval: vi
      .fn<WorkCounterpartPorts["readApproval"]>()
      .mockImplementation(async ({ candidate: item }) => ({
        candidateId: item.id,
        digest: workCounterpartLearningDigest(item),
        verifiedByUserId: "independent-verifier",
        approvedByUserId: "human-reviewer",
        status: "approved",
      })),
    inspectSource: vi
      .fn<WorkCounterpartPorts["inspectSource"]>()
      .mockImplementation(async ({ ref }) => sourceAccess(ref)),
    readSource: vi
      .fn<WorkCounterpartPorts["readSource"]>()
      .mockImplementation(async ({ ref }) => ref),
  } satisfies WorkCounterpartPorts;
}

function sourceAccess(ref: WorkCounterpartSourceRef) {
  return {
    ...ref,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    classification: "organization_managed",
    authorPrincipalId: "verified-provider-actor",
    readableByAudience: true,
  } as const;
}

function load(
  ports: WorkCounterpartPorts,
  candidates = [candidate] as WorkCounterpartLearning[]
) {
  return collectWorkCounterpartContext(
    { enabled: true, scope, candidates },
    ports
  );
}

it("is disabled by default without touching identity, approval, or sources", async () => {
  const ports = fakePorts();
  await expect(
    collectWorkCounterpartContext({ scope, candidates: [candidate] }, ports)
  ).resolves.toEqual({
    status: "disabled",
    notes: [],
    omitted: 0,
  });
  for (const callback of Object.values(ports)) {
    expect(callback).not.toHaveBeenCalled();
  }
});

it("proposes learning only from outcomes/corrections, without publishing or approving it", async () => {
  const input = {
    id: candidate.id,
    proposedByUserId: candidate.proposedByUserId,
    summary: candidate.text,
  };
  expect(
    proposeWorkCounterpartLearning({ ...input, observation: approvedDocument })
  ).toBeNull();
  const proposal = proposeWorkCounterpartLearning({
    ...input,
    observation: outcome,
    supportingSources: [approvedDocument],
  });
  expect(proposal).toEqual(candidate);
  const ports = fakePorts();
  ports.readApproval.mockResolvedValue(null);
  await expect(load(ports)).resolves.toEqual({
    status: "ready",
    notes: [],
    omitted: 1,
  });
  expect(ports.inspectSource).not.toHaveBeenCalled();
});

it("admits an independently verified and human approved learning with exact citations only", async () => {
  const ports = fakePorts();
  await expect(load(ports)).resolves.toEqual({
    status: "ready",
    notes: [
      { id: candidate.id, text: candidate.text, sources: candidate.sources },
    ],
    omitted: 0,
  });
  expect(ports.inspectSource).toHaveBeenCalledTimes(4);
  expect(ports.readSource).toHaveBeenCalledTimes(2);
  expect(ports.readApproval).toHaveBeenCalledTimes(2);
  expect(ports.inspectSource).toHaveBeenCalledWith({ scope, ref: outcome });
});

it.each([
  "author-as-verifier",
  "author-as-approver",
  "edited-content",
] as const)("does not use a rejected approval (%s)", async (failure) => {
  const ports = fakePorts();
  ports.readApproval.mockResolvedValue({
    candidateId: candidate.id,
    digest: workCounterpartLearningDigest(
      failure === "edited-content"
        ? { ...candidate, text: "Edited after review." }
        : candidate
    ),
    verifiedByUserId:
      failure === "author-as-verifier"
        ? candidate.proposedByUserId
        : "independent",
    approvedByUserId:
      failure === "author-as-approver"
        ? candidate.proposedByUserId
        : "reviewer",
    status: "approved",
  });
  await expect(load(ports)).resolves.toMatchObject({ notes: [], omitted: 1 });
  expect(ports.inspectSource).not.toHaveBeenCalled();
});

it.each([
  { classification: "private" },
  { classification: "mixed" },
  { classification: "unknown" },
  { organizationId: "different-org" },
  { projectId: "different-project" },
  { readableByAudience: false },
  { revision: "unreviewed-revision" },
  { authorPrincipalId: "" },
] as const)("does not read either source body when evidence is ineligible (%j)", async (change) => {
  const ports = fakePorts();
  ports.inspectSource.mockImplementation(async ({ ref }) => ({
    ...sourceAccess(ref),
    ...(ref.id === approvedDocument.id ? change : {}),
  }));
  await expect(load(ports)).resolves.toEqual({
    status: "ready",
    notes: [],
    omitted: 1,
  });
  expect(ports.readSource).not.toHaveBeenCalled();
});

it("does not disclose a staged learning revoked while a later learning was read", async () => {
  const ports = fakePorts();
  const later = { ...outcome, id: "fictional-later-evidence" };
  let revoked = false;
  ports.readSource.mockImplementation(({ ref }) => {
    if (ref.id === later.id) {
      revoked = true;
    }
    return Promise.resolve(ref);
  });
  ports.inspectSource.mockImplementation(async ({ ref }) => ({
    ...sourceAccess(ref),
    readableByAudience: !(revoked && ref.id === outcome.id),
  }));
  await expect(
    load(ports, [
      candidate,
      { ...candidate, id: "later-learning", sources: [later] },
    ])
  ).resolves.toEqual({
    status: "ready",
    notes: [{ id: "later-learning", text: candidate.text, sources: [later] }],
    omitted: 1,
  });
});

it("discards exact-source changes, withdrawn approvals, and revoked audience without reusing cached notes", async () => {
  const ports = fakePorts();
  expect((await load(ports)).notes).toHaveLength(1);
  ports.readSource.mockResolvedValueOnce({
    ...outcome,
    revision: "edited-since-review",
  });
  await expect(load(ports)).resolves.toMatchObject({ notes: [], omitted: 1 });
  ports.readApproval
    .mockImplementationOnce(async ({ candidate: item }) => ({
      candidateId: item.id,
      digest: workCounterpartLearningDigest(item),
      verifiedByUserId: "independent-verifier",
      approvedByUserId: "human-reviewer",
      status: "approved",
    }))
    .mockResolvedValueOnce(null);
  await expect(load(ports)).resolves.toMatchObject({ notes: [], omitted: 1 });
  ports.authorizeScope.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(load(ports)).resolves.toEqual({
    status: "denied",
    notes: [],
    omitted: 0,
  });
});

it("does not touch source ports for unresolved requester/audience or denied scope", async () => {
  const ports = fakePorts();
  await expect(
    collectWorkCounterpartContext(
      {
        enabled: true,
        scope: { ...scope, audienceUserIds: ["someone-else"] },
        candidates: [candidate],
      },
      ports
    )
  ).resolves.toEqual({ status: "denied", notes: [], omitted: 0 });
  expect(ports.authorizeScope).not.toHaveBeenCalled();
  ports.authorizeScope.mockRejectedValue(
    new Error("scope service unavailable")
  );
  await expect(load(ports)).resolves.toMatchObject({
    status: "denied",
    notes: [],
  });
  expect(ports.readApproval).not.toHaveBeenCalled();
  expect(ports.readSource).not.toHaveBeenCalled();
});

it("bounds the consulted candidates and context bytes instead of truncating observations", async () => {
  const ports = fakePorts();
  ports.readApproval.mockResolvedValue(null);
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    ...candidate,
    id: `proposal-${index}`,
  }));
  await expect(load(ports, candidates)).resolves.toMatchObject({
    notes: [],
    omitted: 40,
  });
  expect(ports.readApproval).toHaveBeenCalledTimes(12);
  const eligible = fakePorts();
  const longCandidates = candidates.map((item) => ({
    ...item,
    text: "x".repeat(360),
    sources: [
      { ...outcome, id: "a".repeat(128), revision: "b".repeat(128) },
      approvedDocument,
    ],
  }));
  const context = await load(eligible, longCandidates);
  expect(context.notes.length).toBeGreaterThan(0);
  expect(context.notes.length).toBeLessThanOrEqual(3);
  expect(Buffer.byteLength(JSON.stringify(context.notes))).toBeLessThanOrEqual(
    1800
  );
  expect(context.notes.every(({ text }) => text.length === 360)).toBe(true);
});

it("uses one immutable candidate for the digest and projection across awaits", async () => {
  const ports = fakePorts();
  const original = { ...candidate, text: "Reviewed work decision." };
  const note = { ...original };
  ports.readSource.mockImplementation(({ ref }) => {
    original.text = "Not the exact reviewed candidate.";
    return Promise.resolve(ref);
  });
  await expect(load(ports, [original])).resolves.toMatchObject({
    status: "ready",
    notes: [{ id: note.id, text: note.text, sources: note.sources }],
    omitted: 0,
  });
  expect(original.text).toBe("Not the exact reviewed candidate.");
});

it("runs the synthetic OpenMeld PR-review acceptance", async () => {
  await expect(runWorkCounterpartPrReviewAcceptance()).resolves.toBeDefined();
});
