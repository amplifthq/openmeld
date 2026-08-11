import type { OrganizationMemberOpenMeldServiceStatusesResponse } from "@openmeld/schemas/types";
import {
  type OrganizationMemberOpenMeldServiceSession,
  resolveOrganizationMemberOpenMeldServiceState,
} from "./organization-member-openmeld-service-status";

const MEMBER_SERVICE_LOOKUP_CONCURRENCY = 8;

type LookupMemberServiceSessions = (input: {
  userId: string;
}) => Promise<readonly OrganizationMemberOpenMeldServiceSession[]>;

export async function listOrganizationMemberOpenMeldServiceStatuses(input: {
  generatedAt: string;
  lookupMemberServiceSessions: LookupMemberServiceSessions;
  memberUserIds: readonly string[];
  onLookupError: (input: { error: unknown; userId: string }) => void;
  organizationId: string;
}): Promise<OrganizationMemberOpenMeldServiceStatusesResponse> {
  const members: OrganizationMemberOpenMeldServiceStatusesResponse["members"] =
    new Array(input.memberUserIds.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < input.memberUserIds.length) {
      const index = nextIndex;
      nextIndex += 1;
      const userId = input.memberUserIds[index];
      if (!userId) {
        continue;
      }
      try {
        const sessions = await input.lookupMemberServiceSessions({ userId });
        members[index] = {
          state: resolveOrganizationMemberOpenMeldServiceState({ sessions }),
          userId,
        };
      } catch (error) {
        input.onLookupError({ error, userId });
        members[index] = { state: "unknown", userId };
      }
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          MEMBER_SERVICE_LOOKUP_CONCURRENCY,
          input.memberUserIds.length
        ),
      },
      worker
    )
  );

  return {
    generatedAt: input.generatedAt,
    members,
    organizationId: input.organizationId,
  };
}
