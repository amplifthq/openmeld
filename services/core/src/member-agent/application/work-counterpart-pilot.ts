import { createHash } from "node:crypto";

const MAX_AUDIENCE = 16;
const MAX_CANDIDATES = 12;
const MAX_NOTES = 3;
const MAX_REFERENCES = 4;
const MAX_NOTE_BYTES = 360;
const MAX_CONTEXT_BYTES = 1800;
const encoder = new TextEncoder();

type WorkCounterpartSourceKind =
  | "merged_pr"
  | "approved_document"
  | "verified_outcome"
  | "reviewed_correction";

export type WorkCounterpartScope = {
  organizationId: string;
  projectId: string;
  profileId: string;
  requesterUserId: string;
  audienceUserIds: readonly string[];
};

export type WorkCounterpartSourceRef = {
  id: string;
  revision: string;
  kind: WorkCounterpartSourceKind;
};

export type WorkCounterpartLearning = {
  id: string;
  text: string;
  proposedByUserId: string;
  sources: readonly WorkCounterpartSourceRef[];
};

type Note = Pick<WorkCounterpartLearning, "id" | "text" | "sources">;

type SourceAccess = WorkCounterpartSourceRef & {
  organizationId: string;
  projectId: string;
  classification: "organization_managed" | "private" | "mixed" | "unknown";
  readableByAudience: boolean;
  authorPrincipalId: string;
};

type Approval = {
  candidateId: string;
  digest: string;
  verifiedByUserId: string;
  approvedByUserId: string;
  status: "approved";
};

/**
 * Server-side sources of truth, not arguments supplied by a model or client.
 * Scope authorization checks the existing counterpart Profile, Project,
 * requester and complete response audience. Source inspection must not read
 * the source body and must attest the whole audience's current access.
 */
export type WorkCounterpartPorts = {
  authorizeScope(scope: WorkCounterpartScope): Promise<boolean>;
  readApproval(input: {
    scope: WorkCounterpartScope;
    candidate: WorkCounterpartLearning;
  }): Promise<Approval | null>;
  inspectSource(input: {
    scope: WorkCounterpartScope;
    ref: WorkCounterpartSourceRef;
  }): Promise<SourceAccess | null>;
  /** Reauthorize the entire audience at the read boundary and read only the
   * exact revision. Never substitute newer content or another credential. */
  readSource(input: {
    scope: WorkCounterpartScope;
    ref: WorkCounterpartSourceRef;
  }): Promise<WorkCounterpartSourceRef | null>;
};

type ContextResult =
  | { status: "disabled" | "denied"; notes: readonly []; omitted: 0 }
  | { status: "ready"; notes: readonly Note[]; omitted: number };

const sourceKinds = new Set<WorkCounterpartSourceKind>([
  "merged_pr",
  "approved_document",
  "verified_outcome",
  "reviewed_correction",
]);

/** Makes a reviewable candidate only; does not grant, approve or persist it. */
export function proposeWorkCounterpartLearning(input: {
  id: string;
  proposedByUserId: string;
  summary: string;
  observation: WorkCounterpartSourceRef;
  supportingSources?: readonly WorkCounterpartSourceRef[];
}): WorkCounterpartLearning | null {
  if (!isLearningObservation(input.observation)) {
    return null;
  }
  const candidate = {
    id: input.id,
    text: input.summary,
    proposedByUserId: input.proposedByUserId,
    sources: [input.observation, ...(input.supportingSources ?? [])],
  };
  return isValidLearning(candidate) ? candidate : null;
}

export function workCounterpartLearningDigest(
  candidate: WorkCounterpartLearning
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "work-counterpart-learning/v1",
        candidate.id,
        candidate.proposedByUserId,
        candidate.text,
        candidate.sources.map(({ id, revision, kind }) => [kind, id, revision]),
      ])
    )
    .digest("hex");
}

/**
 * Collects a bounded, cited context for one request. No durable reads are
 * reused across requests, and missing/changed source data never become notes.
 * This is a policy seam, not a production Wake, chat, or connector entry point.
 */
export async function collectWorkCounterpartContext(
  input: {
    enabled?: boolean;
    scope: WorkCounterpartScope;
    candidates: readonly WorkCounterpartLearning[];
  },
  ports: WorkCounterpartPorts
): Promise<ContextResult> {
  if (input.enabled !== true) {
    return { status: "disabled", notes: [], omitted: 0 };
  }
  if (!isValidScope(input.scope)) {
    return { status: "denied", notes: [], omitted: 0 };
  }
  const scope: WorkCounterpartScope = Object.freeze({
    organizationId: input.scope.organizationId,
    projectId: input.scope.projectId,
    profileId: input.scope.profileId,
    requesterUserId: input.scope.requesterUserId,
    audienceUserIds: Object.freeze([...input.scope.audienceUserIds]),
  });
  if (!(await authorizeScope(ports, scope))) {
    return { status: "denied", notes: [], omitted: 0 };
  }

  const staged: {
    note: Note;
    candidate: WorkCounterpartLearning;
    authors: readonly string[];
  }[] = [];
  const seen = new Set<string>();
  let bytes = 2; // JSON array delimiters
  const candidateCount = input.candidates.length;
  for (const item of input.candidates.slice(0, MAX_CANDIDATES)) {
    if (staged.length === MAX_NOTES) {
      break;
    }
    if (!isValidLearning(item) || seen.has(item.id)) {
      continue;
    }
    // A digest, source review and returned note must all use the same
    // immutable candidate, even across awaited provider operations.
    const note = toNote(item);
    const candidate: WorkCounterpartLearning = Object.freeze({
      ...note,
      proposedByUserId: item.proposedByUserId,
    });
    seen.add(candidate.id);
    const nextBytes =
      bytes +
      encoder.encode(JSON.stringify(note)).byteLength +
      Number(staged.length > 0);
    if (nextBytes > MAX_CONTEXT_BYTES) {
      continue;
    }
    const authors = await readLearningSourceRevisions(ports, scope, candidate);
    if (authors) {
      staged.push({ note, candidate, authors });
      bytes = nextBytes;
    }
  }

  // Recheck all selected notes at the projection boundary, including notes
  // whose reads finished before a later candidate was processed.
  const notes = (
    await Promise.all(
      staged.map(async ({ note, candidate, authors }) =>
        (await confirmLearning(ports, scope, candidate, authors)) ? note : null
      )
    )
  ).filter((note): note is Note => note !== null);
  if (!(await authorizeScope(ports, scope))) {
    return { status: "denied", notes: [], omitted: 0 };
  }
  return {
    status: "ready",
    notes,
    omitted: candidateCount - notes.length,
  };
}

function toNote(candidate: WorkCounterpartLearning): Note {
  return Object.freeze({
    id: candidate.id,
    text: candidate.text,
    sources: Object.freeze(
      candidate.sources.map(({ id, revision, kind }) =>
        Object.freeze({ id, revision, kind })
      )
    ),
  });
}

async function authorizeScope(
  ports: WorkCounterpartPorts,
  scope: WorkCounterpartScope
): Promise<boolean> {
  try {
    return (await ports.authorizeScope(scope)) === true;
  } catch {
    return false;
  }
}

async function readLearningSourceRevisions(
  ports: WorkCounterpartPorts,
  scope: WorkCounterpartScope,
  candidate: WorkCounterpartLearning
): Promise<readonly string[] | null> {
  try {
    const approval = await ports.readApproval({ scope, candidate });
    if (
      !isApproved(approval, candidate, workCounterpartLearningDigest(candidate))
    ) {
      return null;
    }
    const requests = candidate.sources.map((ref) => ({ scope, ref }));
    // Inspect every source before any body read. One unreadable source protects
    // the whole learning; do not disclose other evidence stitched to it.
    const before = await Promise.all(
      requests.map((request) => ports.inspectSource(request))
    );
    const readable = before.every(
      (access, index) =>
        access !== null &&
        sourceIsReadable(access, scope, candidate.sources[index])
    );
    if (!readable) {
      return null;
    }
    const reads = await Promise.all(
      requests.map((request) => ports.readSource(request))
    );
    if (!reads.every((ref, index) => sameRef(ref, candidate.sources[index]))) {
      return null;
    }
    return before.flatMap((access) =>
      access ? [access.authorPrincipalId] : []
    );
  } catch {
    return null;
  }
}

async function confirmLearning(
  ports: WorkCounterpartPorts,
  scope: WorkCounterpartScope,
  candidate: WorkCounterpartLearning,
  authors: readonly string[]
): Promise<boolean> {
  try {
    const [after, approval] = await Promise.all([
      Promise.all(
        candidate.sources.map((ref) => ports.inspectSource({ scope, ref }))
      ),
      ports.readApproval({ scope, candidate }),
    ]);
    return (
      after.every(
        (access, index) =>
          access !== null &&
          sourceIsReadable(access, scope, candidate.sources[index]) &&
          access.authorPrincipalId === authors[index]
      ) &&
      isApproved(approval, candidate, workCounterpartLearningDigest(candidate))
    );
  } catch {
    return false;
  }
}

function isApproved(
  approval: Approval | null,
  candidate: WorkCounterpartLearning,
  digest: string
): boolean {
  return (
    approval !== null &&
    approval.status === "approved" &&
    approval.candidateId === candidate.id &&
    approval.digest === digest &&
    isIdentifier(approval.verifiedByUserId) &&
    isIdentifier(approval.approvedByUserId) &&
    approval.verifiedByUserId !== candidate.proposedByUserId &&
    approval.approvedByUserId !== candidate.proposedByUserId
  );
}

function sourceIsReadable(
  access: SourceAccess,
  scope: WorkCounterpartScope,
  ref: WorkCounterpartSourceRef | undefined
): boolean {
  return (
    sameRef(access, ref) &&
    access.organizationId === scope.organizationId &&
    access.projectId === scope.projectId &&
    access.classification === "organization_managed" &&
    access.readableByAudience === true &&
    isIdentifier(access.authorPrincipalId)
  );
}

function sameRef(
  actual: WorkCounterpartSourceRef | null,
  expected: WorkCounterpartSourceRef | undefined
): boolean {
  return (
    actual !== null &&
    expected !== undefined &&
    actual.kind === expected.kind &&
    actual.id === expected.id &&
    actual.revision === expected.revision
  );
}

function isIdentifier(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value
  );
}

function isValidScope(scope: WorkCounterpartScope): boolean {
  const audience = scope.audienceUserIds;
  return (
    [
      scope.organizationId,
      scope.projectId,
      scope.profileId,
      scope.requesterUserId,
    ].every(isIdentifier) &&
    audience.length >= 1 &&
    audience.length <= MAX_AUDIENCE &&
    audience.every(isIdentifier) &&
    audience.includes(scope.requesterUserId) &&
    new Set(audience).size === audience.length
  );
}

function isLearningObservation(source: WorkCounterpartSourceRef): boolean {
  return (
    source.kind === "verified_outcome" || source.kind === "reviewed_correction"
  );
}

function isValidLearning(candidate: WorkCounterpartLearning): boolean {
  return (
    isIdentifier(candidate.id) &&
    isIdentifier(candidate.proposedByUserId) &&
    candidate.text.length > 0 &&
    candidate.text.length <= MAX_NOTE_BYTES &&
    candidate.text.trim() === candidate.text &&
    encoder.encode(candidate.text).byteLength <= MAX_NOTE_BYTES &&
    candidate.sources.length > 0 &&
    candidate.sources.length <= MAX_REFERENCES &&
    candidate.sources.every(
      ({ id, revision, kind }) =>
        isIdentifier(id) && isIdentifier(revision) && sourceKinds.has(kind)
    ) &&
    candidate.sources.some(isLearningObservation) &&
    new Set(candidate.sources.map(({ id, kind }) => JSON.stringify([kind, id])))
      .size === candidate.sources.length
  );
}
