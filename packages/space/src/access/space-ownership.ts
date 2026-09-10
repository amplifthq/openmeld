/** Ownership belongs to the Space, independently of its historical creator. */
export function isSpaceOwner(input: {
  ownerUserIds: readonly string[];
  actorOwnerUserId: string | null | undefined;
  actorKind: string | null | undefined;
}): boolean {
  return (
    input.actorKind === "human" &&
    Boolean(
      input.actorOwnerUserId &&
        input.ownerUserIds.includes(input.actorOwnerUserId)
    )
  );
}

export function changeSpaceOwners(input: {
  ownerUserIds: readonly string[];
  userId: string;
  role: "owner" | "member";
}):
  | { ok: true; ownerUserIds: string[] }
  | { ok: false; code: "space.last_owner" } {
  const owners = new Set(input.ownerUserIds);
  if (input.role === "owner") {
    owners.add(input.userId);
  } else {
    owners.delete(input.userId);
  }
  if (owners.size === 0) {
    return { ok: false, code: "space.last_owner" };
  }
  return { ok: true, ownerUserIds: [...owners].sort() };
}
