import type { Client } from "pg";

export type MemberAgentInvariantName =
  | "enabled_profile_has_matching_member_agent"
  | "one_member_agent_per_owner_harness"
  | "default_profile_belongs_to_member_agent";

export type MemberAgentInvariantViolations = Record<
  MemberAgentInvariantName,
  number
>;

export type MemberAgentBackfillCounts = {
  memberAgentsCreated: number;
  profilesAssigned: number;
  defaultProfilesSet: number;
  profilesUnassigned: {
    never_bound: number;
    binding_owner_mismatch: number;
    custom_controller: number;
    unknown_controller: number;
  };
  profilesWithHarnessUnassigned: number;
  invariantViolations: MemberAgentInvariantViolations;
};

export const MEMBER_AGENT_INVARIANTS: readonly {
  id: 1 | 2 | 3;
  name: MemberAgentInvariantName;
  sql: string;
  usesBuiltinHarnessKinds: boolean;
}[];

export function harnessKindSql(refExpression: string): string;

type QueryClient = Pick<Client, "query">;

export function checkMemberAgentInvariants(
  client: QueryClient
): Promise<MemberAgentInvariantViolations>;

export function backfillMemberAgents(
  client: QueryClient
): Promise<MemberAgentBackfillCounts>;
