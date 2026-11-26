import {
  type OrganizationMemberRemovalPlan,
  type OrganizationMemberRemovalPrepareInput,
  type OrganizationMemberRemovalPreviewInput,
  organizationMemberRemovalPrepareInputSchema,
  organizationMemberRemovalPreviewInputSchema,
} from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { resolveSpaceStub } from "../rpc/space-ref";
import {
  organizationMemberRemovalDefaultSuccessorChanged,
  readOrganizationMemberRemovalDefaultSuccessor,
  requireOrganizationMemberRemovalManager,
  requireOrganizationMemberRemovalSuccessor,
} from "./member-removal-authorization";

export async function previewOrganizationMemberRemoval(
  env: CoreBindings,
  raw: OrganizationMemberRemovalPreviewInput
): Promise<OrganizationMemberRemovalPlan> {
  const parsed = organizationMemberRemovalPreviewInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid member removal request.",
    });
  }
  const input = parsed.data;
  const authorized = await requireOrganizationMemberRemovalManager(env, input);
  const rows = await authorized.db.query<{ space_id: string }>({
    text: 'SELECT space_id FROM "openmeld"."space_owner_member_references" WHERE member_id = $1 ORDER BY space_id',
    values: [authorized.memberId],
  });
  const spaces: OrganizationMemberRemovalPlan["spaces"] = [];
  const defaultSuccessor =
    input.includeDefaultSuccessor && rows.rows.length
      ? await readOrganizationMemberRemovalDefaultSuccessor(env, authorized)
      : null;
  let hasTransfers = false;
  let allTransfersEligibleForDefault = true;
  for (const row of rows.rows) {
    const stub = resolveSpaceStub(env.OPENMELD_SPACES, row.space_id);
    if (!stub) {
      throw new Error("Couldn't review Space ownership. Try again.");
    }
    const space = await stub.rpcPreviewOrganizationMemberRemovalSpace({
      context: input.context,
      memberId: input.memberId,
      spaceId: row.space_id,
      ...(defaultSuccessor
        ? { defaultSuccessorProfileId: defaultSuccessor.profileId }
        : {}),
    });
    if (space) {
      const { defaultSuccessorEligible, ...summary } = space;
      if (summary.action === "transfer") {
        hasTransfers = true;
        allTransfersEligibleForDefault &&= defaultSuccessorEligible === true;
      }
      spaces.push(summary);
    }
  }
  return {
    memberId: input.memberId,
    userId: authorized.userId,
    spaces,
    ...(defaultSuccessor && hasTransfers && allTransfersEligibleForDefault
      ? {
          defaultSuccessor: {
            userId: defaultSuccessor.ownerUserId,
            profileName: defaultSuccessor.profileName,
          },
        }
      : {}),
  };
}

export async function prepareOrganizationMemberRemoval(
  env: CoreBindings,
  raw: OrganizationMemberRemovalPrepareInput
): Promise<{ prepared: true }> {
  const parsed = organizationMemberRemovalPrepareInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "Invalid member removal request.",
    });
  }
  const input = parsed.data;
  const previewInput = { context: input.context, memberId: input.memberId };
  const authorized = await requireOrganizationMemberRemovalManager(
    env,
    previewInput
  );
  const current = await previewOrganizationMemberRemoval(env, {
    ...previewInput,
    ...(input.useDefaultSuccessor ? { includeDefaultSuccessor: true } : {}),
  });
  const expected = [...input.spaces].sort((a, b) =>
    a.spaceId.localeCompare(b.spaceId)
  );
  if (JSON.stringify(current.spaces) !== JSON.stringify(expected)) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "organization.member_removal_changed",
      reason:
        "Space ownership changed. Review this member's Spaces again before removing them.",
    });
  }
  if (input.useDefaultSuccessor) {
    if (
      !current.defaultSuccessor ||
      current.defaultSuccessor.userId !== input.successorUserId
    ) {
      throw organizationMemberRemovalDefaultSuccessorChanged();
    }
  } else if (current.spaces.some((space) => space.action === "transfer")) {
    await requireOrganizationMemberRemovalSuccessor(
      authorized,
      input.successorUserId
    );
  }
  // Each Space rechecks the confirmed action under its own serialization gate.
  // These explicitly confirmed handoffs remain saved if a later action fails;
  // native Auth removal still enforces every ownership reference and permission.
  for (const space of current.spaces) {
    const stub = resolveSpaceStub(env.OPENMELD_SPACES, space.spaceId);
    if (!stub) {
      throw new Error(
        "Couldn't prepare Space ownership. Review and try again."
      );
    }
    await stub.rpcPrepareOrganizationMemberRemovalSpace({
      ...previewInput,
      spaceId: space.spaceId,
      expected: space,
      ...(input.successorUserId
        ? { successorUserId: input.successorUserId }
        : {}),
      ...(input.useDefaultSuccessor && space.action === "transfer"
        ? { useDefaultSuccessor: true }
        : {}),
    });
  }
  return { prepared: true };
}
