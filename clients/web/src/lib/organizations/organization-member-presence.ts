import {
	HUMAN_PRESENCE_HEARTBEAT_MS,
	organizationMemberPresenceResponseSchema,
	organizationMemberPresenceWriteResponseSchema,
} from "@openmeld/schemas";
import type { OrganizationMemberPresenceBody } from "@openmeld/schemas/types";
import { useQuery } from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export const memberPresenceQueryKey = (organizationId: string) =>
	["organization", organizationId, "member-presence"] as const;
const route = "/v1/organizations/current/member-presence";

export function recordCurrentOrganizationMemberPresence(
	organizationId: string,
	report: OrganizationMemberPresenceBody
) {
	return createOrganizationScopedWebOpenMeldApiFoundation({
		organizationId,
	}).requestJson({
		method: "POST",
		operation: "organization.member_presence.record",
		url: route,
		body: JSON.stringify(report),
		schema: organizationMemberPresenceWriteResponseSchema,
		invalidMessage: "Invalid member presence response.",
	});
}

export function useOrganizationMemberPresence(organizationId: string) {
	return useQuery({
		queryKey: memberPresenceQueryKey(organizationId),
		queryFn: async () => {
			const response = await createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId,
			}).requestJson({
				method: "GET",
				operation: "organization.member_presence.read",
				url: route,
				schema: organizationMemberPresenceResponseSchema,
				invalidMessage: "Invalid member presence response.",
			});
			if (response.organizationId !== organizationId) {
				throw new Error("Member presence belongs to another Organization.");
			}
			return response;
		},
		refetchInterval: HUMAN_PRESENCE_HEARTBEAT_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: "always",
		staleTime: 10_000,
		retry: false,
	});
}
