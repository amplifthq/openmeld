import { createSensitiveOperationsApi } from "@openmeld/api-client";
import type { CredentialConfirmationDecision } from "@openmeld/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { invalidateInboxFacts } from "./organizations/inbox";

// Credential confirmations and the sensitive operation audit
// (member-agent-program.md §4.7). Core owns their state.

const PENDING_REFETCH_MS = 15_000;

export const sensitiveOperationQueryKeys = {
	all: (organizationId: string) =>
		["sensitive-operations", organizationId] as const,
	confirmation: (organizationId: string, confirmationId: string) =>
		[
			...sensitiveOperationQueryKeys.all(organizationId),
			"confirmation",
			confirmationId,
		] as const,
	audit: (organizationId: string, memberAgentId: string) =>
		[
			...sensitiveOperationQueryKeys.all(organizationId),
			"audit",
			memberAgentId,
		] as const,
};

function sensitiveOperationsApi(organizationId: string) {
	return createSensitiveOperationsApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
}

export function useCredentialConfirmation(confirmationId: string) {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useQuery({
		queryKey: sensitiveOperationQueryKeys.confirmation(
			organizationId,
			confirmationId
		),
		enabled: Boolean(organizationId) && isMemberAgentsEnabled(),
		queryFn: async () =>
			(
				await sensitiveOperationsApi(organizationId).getConfirmation(
					confirmationId
				)
			).confirmation,
		retry: false,
		refetchInterval: (query) =>
			query.state.data?.status === "pending" ? PENDING_REFETCH_MS : false,
	});
}

export function useDecideCredentialConfirmation() {
	const queryClient = useQueryClient();
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useMutation({
		mutationFn: async (input: {
			confirmationId: string;
			decision: CredentialConfirmationDecision;
		}) =>
			await sensitiveOperationsApi(organizationId).decideConfirmation(
				input.confirmationId,
				input.decision
			),
		retry: false,
		onSuccess: (response) => {
			queryClient.setQueryData(
				sensitiveOperationQueryKeys.confirmation(
					organizationId,
					response.confirmation.id
				),
				response.confirmation
			);
		},
		onSettled: async () =>
			await invalidateInboxFacts({ organizationId, queryClient }),
	});
}

export function useMemberAgentSensitiveOperationAudit(memberAgentId: string) {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useQuery({
		queryKey: sensitiveOperationQueryKeys.audit(organizationId, memberAgentId),
		enabled:
			Boolean(organizationId && memberAgentId) && isMemberAgentsEnabled(),
		queryFn: async () =>
			(
				await sensitiveOperationsApi(organizationId).listMemberAgentAudit(
					memberAgentId
				)
			).events,
		staleTime: 30_000,
	});
}
