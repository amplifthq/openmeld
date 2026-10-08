import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { SpaceOwnerDepartureWorker } from "@openmeld/schemas";
import {
  type AgentActivitySessionInventoryLifecycleWorker,
  finalizeAgentActivitySessionInventoryCleanupAfterOrganizationMemberRemoval,
  requireAgentActivitySessionInventoryCleanupBeforeOrganizationMemberRemoval,
} from "./agent-activity-session-inventory-lifecycle";
import { assertCenterAgentIdentityBeforeMemberRemoval } from "./center-agent-member-removal-guard";
import {
  type CenterAgentMemoryLifecycleWorker,
  deleteCenterAgentMemberMemoryOnOrganizationRemoval,
} from "./center-agent-memory-lifecycle";
import { requireSpaceOwnershipHandoff } from "./space-owner-departure";

export type OrganizationMemberDepartureDependencies = {
  coreWorker?: SpaceOwnerDepartureWorker &
    AgentActivitySessionInventoryLifecycleWorker &
    CenterAgentMemoryLifecycleWorker;
  db?: PostgresDatabase;
};

type MemberDepartureInput = OrganizationMemberDepartureDependencies & {
  organizationId: string;
  userId: string;
};

/** Prepare only: the durable cleanup waits for authoritative membership removal. */
export async function prepareOrganizationMemberDeparture(
  input: MemberDepartureInput
): Promise<void> {
  await requireSpaceOwnershipHandoff(input);
  await assertCenterAgentIdentityBeforeMemberRemoval(input);
  await requireAgentActivitySessionInventoryCleanupBeforeOrganizationMemberRemoval(
    input
  );
}

/** Called only after the native membership deletion succeeds. */
export async function finalizeOrganizationMemberDeparture(
  input: MemberDepartureInput
): Promise<void> {
  await Promise.all([
    finalizeAgentActivitySessionInventoryCleanupAfterOrganizationMemberRemoval(
      input
    ),
    deleteCenterAgentMemberMemoryOnOrganizationRemoval(input),
  ]);
}
