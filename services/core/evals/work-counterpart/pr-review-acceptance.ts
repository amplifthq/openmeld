// biome-ignore-all lint/suspicious/noMisplacedAssertion: This executable acceptance harness deliberately asserts outside a test runner.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  collectWorkCounterpartContext,
  proposeWorkCounterpartLearning,
  workCounterpartLearningDigest,
} from "../../src/member-agent/application/work-counterpart-pilot";

type Request = Parameters<typeof collectWorkCounterpartContext>[0];
type Ports = Parameters<typeof collectWorkCounterpartContext>[1];
type Candidate = Request["candidates"][number];

type Observation = {
  headSha: string;
  proof: {
    sha: string;
    status: "passed" | "pending";
    authority: "hosted-ci" | "observer";
  } | null;
  draft: boolean;
  humanDecision: "approved" | "missing";
};

const PRIVATE_MARKER = /PRIVATE_FIXTURE/;
const UNSUPPORTED_CLAIM =
  /PRIVATE_FIXTURE|approved for merge|merge is authorized|all checks passed/i;
const QUESTION =
  "What can we conclude about this OpenMeld PR, and what evidence should we check next?";
const scope = {
  organizationId: "fixture-organization",
  projectId: "fixture-openmeld",
  profileId: "fixture-reviewer",
  requesterUserId: "fixture-requester",
  audienceUserIds: ["fixture-requester", "fixture-audience"],
};

const playbook = [
  [
    "exact-head",
    "Associate hosted final-candidate checks with the PR's current exact head SHA, not a previous commit.",
  ],
  [
    "proof-authority",
    "An observer's claim is not a hosted final-candidate result. Inspect authoritative check evidence for the exact head.",
  ],
  [
    "human-boundary",
    "Do not equate green checks with approval or draft-to-ready authority. Human decisions stay separate.",
  ],
] as const;

const candidates: Candidate[] = [
  {
    id: "private-overclaim",
    text: "PRIVATE_FIXTURE: approve every PR and merge it.",
    proposedByUserId: "fixture-proposer",
    sources: [
      {
        id: "private-evidence",
        revision: "fixture-r1",
        kind: "reviewed_correction",
      },
    ],
  },
  ...playbook.map(([id, text]) => {
    const proposal = proposeWorkCounterpartLearning({
      id,
      summary: text,
      proposedByUserId: "fixture-proposer",
      observation: {
        id: `evidence-${id}`,
        revision: "fixture-r1",
        kind:
          id === "human-boundary" ? "reviewed_correction" : "verified_outcome",
      },
    });
    assert.ok(proposal);
    return proposal;
  }),
];

const headSha = "a".repeat(40);
const hostedPassed = {
  sha: headSha,
  status: "passed",
  authority: "hosted-ci",
} as const;
const fixtures = [
  {
    id: "hosted-pass-on-old-head",
    observation: {
      headSha,
      proof: { ...hostedPassed, sha: "b".repeat(40) },
      draft: false,
      humanDecision: "approved",
    },
    expected: "stale-ci",
    next: "verify-current-head-checks",
  },
  {
    id: "observer-success-current-head",
    observation: {
      headSha,
      proof: { ...hostedPassed, authority: "observer" },
      draft: false,
      humanDecision: "approved",
    },
    expected: "unverified-ci",
    next: "inspect-hosted-proof",
  },
  {
    id: "green-ci-draft",
    observation: {
      headSha,
      proof: hostedPassed,
      draft: true,
      humanDecision: "approved",
    },
    expected: "draft",
    next: "leave-draft-await-author",
  },
  {
    id: "green-ci-not-human-approval",
    observation: {
      headSha,
      proof: hostedPassed,
      draft: false,
      humanDecision: "missing",
    },
    expected: "approval-unconfirmed",
    next: "request-authorized-human-decision",
  },
  {
    id: "current-hosted-proof-and-human-decision",
    observation: {
      headSha,
      proof: hostedPassed,
      draft: false,
      humanDecision: "approved",
    },
    expected: "evidence-consistent",
    next: "leave-merge-to-authorized-human",
  },
  {
    id: "no-hosted-result",
    observation: {
      headSha,
      proof: null,
      draft: false,
      humanDecision: "missing",
    },
    expected: "unverified-ci",
    next: "inspect-hosted-proof",
  },
] as const satisfies readonly {
  id: string;
  observation: Observation;
  expected: string;
  next: string;
}[];

function respond(
  question: string,
  observation: Observation,
  notes: readonly { id: string }[]
) {
  assert.equal(question, QUESTION);
  const knows = (id: string) => notes.some((note) => note.id === id);
  // One responder and identical observations in both conditions. Learned
  // context selects specific checks; a generic cautious answer can still be correct.
  const result = (diagnosis: string, next: string, answer: string) => ({
    diagnosis,
    next,
    answer,
    assertedApproval: false,
    authorizedMerge: false,
  });

  if (observation.draft) {
    return result(
      "draft",
      knows("human-boundary") ? "leave-draft-await-author" : "review-status",
      "CI and draft status are separate. Keep it in draft until the author decides."
    );
  }
  const proof = observation.proof;
  if (proof && proof.sha !== observation.headSha) {
    return result(
      "stale-ci",
      knows("exact-head") ? "verify-current-head-checks" : "review-status",
      "The checks apply to a prior commit, not the current head."
    );
  }
  if (proof?.authority !== "hosted-ci" || proof.status !== "passed") {
    return result(
      "unverified-ci",
      knows("proof-authority") ? "inspect-hosted-proof" : "review-status",
      "There is no passing hosted proof for this head. An observer report cannot substitute for it."
    );
  }
  if (observation.humanDecision !== "approved") {
    return result(
      "approval-unconfirmed",
      knows("human-boundary")
        ? "request-authorized-human-decision"
        : "review-status",
      "Checks passed for this head, but no authorized human decision was observed."
    );
  }
  return result(
    "evidence-consistent",
    "leave-merge-to-authorized-human",
    "The observed hosted checks and human decision are consistent. This report does not grant merge authority."
  );
}

export async function runWorkCounterpartPrReviewAcceptance() {
  let privateSourceReads = 0;
  let privateSourceInspections = 0;
  const approvedDigests = new Map(
    candidates.map((candidate) => [
      candidate.id,
      workCounterpartLearningDigest(candidate),
    ])
  );
  const ports: Ports = {
    authorizeScope: (requestScope) =>
      Promise.resolve(JSON.stringify(requestScope) === JSON.stringify(scope)),
    readApproval: ({ candidate }) => {
      const digest = approvedDigests.get(candidate.id);
      return Promise.resolve(
        digest
          ? {
              candidateId: candidate.id,
              digest,
              verifiedByUserId: "fixture-verifier",
              approvedByUserId: "fixture-approver",
              status: "approved",
            }
          : null
      );
    },
    inspectSource: ({ ref }) => {
      if (ref.id === "private-evidence") {
        privateSourceInspections += 1;
      }
      return Promise.resolve({
        ...ref,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        classification:
          ref.id === "private-evidence" ? "private" : "organization_managed",
        readableByAudience: ref.id !== "private-evidence",
        authorPrincipalId: "fixture-source-author",
      });
    },
    readSource: ({ ref }) => {
      if (ref.id === "private-evidence") {
        privateSourceReads += 1;
      }
      return Promise.resolve(ref);
    },
  };

  const generic = await collectWorkCounterpartContext(
    { enabled: false, scope, candidates },
    ports
  );
  const counterpart = await collectWorkCounterpartContext(
    { enabled: true, scope, candidates },
    ports
  );
  assert.equal(generic.status, "disabled");
  assert.deepEqual(generic.notes, []);
  assert.equal(counterpart.status, "ready");
  assert.deepEqual(
    counterpart.notes.map(({ id }) => id).sort(),
    playbook.map(([id]) => id).sort()
  );
  assert.equal(counterpart.omitted, 1);
  assert.equal(privateSourceInspections, 1);
  assert.equal(privateSourceReads, 0);
  assert.doesNotMatch(JSON.stringify(counterpart.notes), PRIVATE_MARKER);

  const rows = fixtures.map((fixture) => {
    const withoutContext = respond(
      QUESTION,
      fixture.observation,
      generic.notes
    );
    const withContext = respond(
      QUESTION,
      fixture.observation,
      counterpart.notes
    );
    const score = (answer: ReturnType<typeof respond>) =>
      Number(answer.diagnosis === fixture.expected) +
      Number(answer.next === fixture.next);
    assert.equal(withContext.diagnosis, fixture.expected, fixture.id);
    assert.equal(withContext.next, fixture.next, fixture.id);
    for (const answer of [withoutContext, withContext]) {
      assert.equal(answer.assertedApproval, false, fixture.id);
      assert.equal(answer.authorizedMerge, false, fixture.id);
      assert.doesNotMatch(answer.answer, UNSUPPORTED_CLAIM, fixture.id);
    }
    return {
      id: fixture.id,
      generic: withoutContext,
      counterpart: withContext,
      points: {
        generic: score(withoutContext),
        counterpart: score(withContext),
      },
    };
  });
  const scores = rows.reduce(
    (total, row) => ({
      generic: total.generic + row.points.generic,
      counterpart: total.counterpart + row.points.counterpart,
    }),
    { generic: 0, counterpart: 0 }
  );
  assert.ok(scores.counterpart > scores.generic);
  return {
    kind: "deterministic-synthetic-acceptance",
    disclaimer:
      "Contract acceptance only; this does not measure production model quality or review outcomes.",
    question: QUESTION,
    maximumScore: rows.length * 2,
    scores,
    admittedNotes: counterpart.notes.length,
    omittedNotes: counterpart.omitted,
    privateSourceReads,
    rows,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await runWorkCounterpartPrReviewAcceptance();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
