import type { RequestChain } from "@openmeld/schemas/types";
import {
  authorizeDirectMessageSessionOperation,
  type DirectMessageSessionAccessInput,
} from "../../space/rules/access/direct-message-session-access";
import {
  collectWorkCounterpartContext,
  type WorkCounterpartLearning,
  type WorkCounterpartPorts,
  type WorkCounterpartScope,
  workCounterpartLearningDigest,
} from "./work-counterpart-pilot";

// These facts must come from live Core execution, Profile, Project and Space
// owners, never from a model argument, URL, Agent Activity or cached DM index.
export type WorkCounterpartOwnerDmFacts = {
  execution: {
    dispatchId: string;
    sourceSignalId: string;
    projectId: string;
    organizationId: string;
    spaceId: string;
    targetProfileId: string;
    requestChain: RequestChain;
  };
  source: {
    signalId: string;
    profileId: string;
    ownerUserId: string;
    kind: "human" | "agent" | "system";
    recalled: boolean;
  };
  dm: {
    organizationId: string;
    spaceId: string;
    accessMode: string;
    meta: DirectMessageSessionAccessInput["meta"];
    members: readonly (DirectMessageSessionAccessInput["members"][number] & {
      ownerUserIdSnapshot: string | null;
    })[];
  };
  directory: {
    ownerUserId: string;
    ownerHumanProfileId: string;
    localCodexProfileId: string;
  };
  project: {
    organizationId: string;
    projectId: string;
    active: boolean;
  };
};

type OwnerDmSelection = {
  organizationId: string;
  projectId: string;
  ownerUserId: string;
  profileId: string;
  learningId: string;
  learningDigest: string;
};

type OwnerDmPorts = Omit<WorkCounterpartPorts, "authorizeScope"> & {
  /**
   * Reauthorize the live execution and resolve canonical participants and
   * Project again, returning null if any authority is stale or unavailable.
   */
  readCurrentFacts(): Promise<WorkCounterpartOwnerDmFacts | null>;
  /** Read only the exact approved, reviewed summary, never a transcript. */
  readSelectedLearning(input: {
    scope: WorkCounterpartScope;
    id: string;
    digest: string;
  }): Promise<WorkCounterpartLearning | null>;
};

const SHA256_DIGEST = /^[a-f0-9]{64}$/u;
const DISABLED = { status: "disabled", notes: [], omitted: 0 } as const;
const DENIED = { status: "denied", notes: [], omitted: 0 } as const;

/**
 * Owner-DM adapter contract for the existing pilot. It does not open a route,
 * enable reads, store a grant, or add a second Workspace identity authority.
 */
export async function collectOwnerDirectMessageWorkCounterpartContext(
  input: {
    selection?: OwnerDmSelection;
  },
  ports: OwnerDmPorts
) {
  if (input.selection === undefined) {
    return DISABLED;
  }
  const selection = Object.freeze({ ...input.selection });
  if (!isValidSelection(selection)) {
    return DENIED;
  }
  const readCurrentFacts = async () => {
    try {
      const facts = await ports.readCurrentFacts();
      return facts && acceptsOwnerDm(selection, facts) ? facts : null;
    } catch {
      return null;
    }
  };
  const admitted = await readCurrentFacts();
  if (!admitted) {
    return DENIED;
  }
  const { dispatchId, sourceSignalId, spaceId } = admitted.execution;
  const humanProfileId = admitted.directory.ownerHumanProfileId;
  const scope = Object.freeze({
    organizationId: selection.organizationId,
    projectId: selection.projectId,
    profileId: selection.profileId,
    requesterUserId: selection.ownerUserId,
    audienceUserIds: Object.freeze([selection.ownerUserId]),
  });
  const stillAuthorized = async () => {
    const live = await readCurrentFacts();
    return Boolean(
      live &&
        live.execution.dispatchId === dispatchId &&
        live.execution.sourceSignalId === sourceSignalId &&
        live.execution.spaceId === spaceId &&
        live.directory.ownerHumanProfileId === humanProfileId
    );
  };
  try {
    const loaded = await ports.readSelectedLearning({
      scope,
      id: selection.learningId,
      digest: selection.learningDigest,
    });
    const candidate =
      loaded &&
      Object.freeze({
        ...loaded,
        sources: Object.freeze(
          loaded.sources.map((source) => Object.freeze({ ...source }))
        ),
      });
    // Do not let the current source or lookup silently replace the selected
    // reviewed body. The pilot also verifies live approval, exact sources and
    // whole-audience access before returning this note.
    const approvedSelection =
      candidate?.id === selection.learningId &&
      workCounterpartLearningDigest(candidate) === selection.learningDigest
        ? [candidate]
        : [];
    return await collectWorkCounterpartContext(
      { enabled: true, scope, candidates: approvedSelection },
      {
        authorizeScope: stillAuthorized,
        readApproval: ports.readApproval,
        inspectSource: ports.inspectSource,
        readSource: async (request) =>
          (await stillAuthorized()) ? await ports.readSource(request) : null,
      }
    );
  } catch {
    return DENIED;
  }
}

function isValidSelection(selection: OwnerDmSelection): boolean {
  return (
    [
      selection.organizationId,
      selection.projectId,
      selection.ownerUserId,
      selection.profileId,
      selection.learningId,
    ].every(
      (value) =>
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 128 &&
        value.trim() === value
    ) && SHA256_DIGEST.test(selection.learningDigest)
  );
}

function acceptsOwnerDm(
  selection: OwnerDmSelection,
  facts: WorkCounterpartOwnerDmFacts
): boolean {
  const { dm, directory, execution, source, project } = facts;
  if (
    !(
      execution.dispatchId &&
      execution.sourceSignalId &&
      execution.spaceId &&
      directory.ownerHumanProfileId &&
      source.kind === "human" &&
      source.recalled === false &&
      source.signalId === execution.sourceSignalId &&
      source.profileId === directory.ownerHumanProfileId &&
      source.ownerUserId === selection.ownerUserId &&
      directory.ownerUserId === selection.ownerUserId &&
      directory.localCodexProfileId === selection.profileId &&
      execution.targetProfileId === selection.profileId &&
      execution.organizationId === selection.organizationId &&
      dm.organizationId === selection.organizationId &&
      dm.spaceId === execution.spaceId &&
      dm.accessMode === "members_only" &&
      execution.projectId === selection.projectId &&
      project.organizationId === selection.organizationId &&
      project.projectId === selection.projectId &&
      project.active === true &&
      isDirectOwnerChain(execution.requestChain, directory)
    )
  ) {
    return false;
  }

  const active = dm.members.filter(({ status }) => status === "active");
  if (
    active.length !== 2 ||
    active.some(
      ({ ownerUserIdSnapshot }) => ownerUserIdSnapshot !== selection.ownerUserId
    )
  ) {
    return false;
  }
  const pair = authorizeDirectMessageSessionOperation({
    actor: {
      openMeldProfileId: directory.ownerHumanProfileId,
      profileKind: source.kind,
    },
    meta: dm.meta,
    members: active,
  });
  return pair.ok && pair.agentProfileId === selection.profileId;
}

function isDirectOwnerChain(
  chain: RequestChain,
  directory: WorkCounterpartOwnerDmFacts["directory"]
): boolean {
  const [root, target] = chain;
  return (
    chain.length === 2 &&
    root?.kind === "human" &&
    root.profileId === directory.ownerHumanProfileId &&
    target?.kind === "agent" &&
    target.profileId === directory.localCodexProfileId
  );
}
