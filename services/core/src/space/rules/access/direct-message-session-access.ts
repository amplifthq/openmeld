import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";

/**
 * Who may rename, archive, or delete an agent Direct Message Session
 * (developing/product/space-collaboration.md, Agent Direct Message Sessions).
 *
 * A Session is one current Direct Message Space whose pair is exactly one
 * Human Profile and one agent Profile. Only that Human, as an active member,
 * may change it. Owner observers, the Agent, other Profiles of the same
 * account, and members of any other Space are refused. These rules never
 * unlock the generic Direct Message metadata, lifecycle, or deletion
 * mutations.
 */
export type DirectMessageSessionAccessInput = {
  actor: {
    openMeldProfileId?: string | null;
    profileKind?: string | null;
  };
  meta: {
    purpose?: string | null;
    deletedAt?: string | null;
    directMessage?: {
      pairKey: string;
      convertedAt?: string | null;
    } | null;
  } | null;
  members: readonly {
    profileId: string;
    profileKindSnapshot: string;
    status: string;
  }[];
};

export type DirectMessageSessionAccess =
  | { ok: true; humanProfileId: string; agentProfileId: string }
  | {
      ok: false;
      code:
        | "direct_message_session.not_found"
        | "direct_message_session.forbidden";
      message: string;
    };

const NOT_FOUND: DirectMessageSessionAccess = {
  ok: false,
  code: "direct_message_session.not_found",
  message: "This chat is unavailable. Open a chat you can access.",
};

const FORBIDDEN: DirectMessageSessionAccess = {
  ok: false,
  code: "direct_message_session.forbidden",
  message: "Only the person in this chat can change it.",
};

export function authorizeDirectMessageSessionOperation(
  input: DirectMessageSessionAccessInput
): DirectMessageSessionAccess {
  const meta = input.meta;
  if (
    !meta ||
    meta.deletedAt ||
    meta.purpose !== OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE ||
    !meta.directMessage ||
    meta.directMessage.convertedAt
  ) {
    return NOT_FOUND;
  }
  const pair = parsePairKey(meta.directMessage.pairKey);
  if (!pair) {
    return NOT_FOUND;
  }
  const actorProfileId = input.actor.openMeldProfileId?.trim() ?? "";
  if (input.actor.profileKind !== "human" || !pair.includes(actorProfileId)) {
    return FORBIDDEN;
  }
  const otherProfileId = pair[0] === actorProfileId ? pair[1] : pair[0];
  const activeMember = (profileId: string) =>
    input.members.find(
      (member) => member.profileId === profileId && member.status === "active"
    );
  const human = activeMember(actorProfileId);
  if (human?.profileKindSnapshot !== "human") {
    return FORBIDDEN;
  }
  const agent = activeMember(otherProfileId);
  // A Human–Human Direct Message is not an agent Session.
  if (agent?.profileKindSnapshot !== "agent") {
    return NOT_FOUND;
  }
  return {
    ok: true,
    humanProfileId: actorProfileId,
    agentProfileId: otherProfileId,
  };
}

function parsePairKey(value: string): [string, string] | null {
  const parts = value.split(":").map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] === parts[1]) {
    return null;
  }
  return [parts[0], parts[1]];
}
