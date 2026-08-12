"use client";

import { useQuery } from "@tanstack/react-query";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import { CenterAgentMemberMemorySection } from "./center-agent-member-memory-section";
import { OrganizationMemoryPolicySection } from "./organization-memory-policy-section";

export function OrganizationMemoryPage() {
	const { currentOrganization, currentUserId } = useAppOrganization();
	return (
		<OrganizationMemoryContent
			currentUserId={currentUserId}
			isPersonalWorkspace={currentOrganization.isPersonal === true}
			organizationId={currentOrganization.id}
			organizationName={currentOrganization.name}
		/>
	);
}

function OrganizationMemoryContent(input: {
	currentUserId: string;
	isPersonalWorkspace: boolean;
	organizationId: string;
	organizationName: string;
}) {
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: !input.isPersonalWorkspace,
			organizationId: input.organizationId,
			userId: input.currentUserId,
		})
	);
	const canManage =
		input.isPersonalWorkspace ||
		canManageOrganizationArea(roleQuery.data, {
			memory: ["manage"],
		});

	return (
		<>
			<AppPageHeader
				description={
					input.isPersonalWorkspace
						? "Control the two kinds of memory your Center Agent uses in this personal workspace."
						: `Manage shared memory for ${input.organizationName} and the personal information this Center Agent remembers about you.`
				}
				eyebrow={
					input.isPersonalWorkspace ? "Personal workspace" : "Organization"
				}
				title="Memory"
			/>
			<OrganizationMemoryPolicySection
				isPersonalWorkspace={input.isPersonalWorkspace}
				organizationId={input.organizationId}
				roleState={{
					canManage,
					errorMessage:
						input.isPersonalWorkspace || !roleQuery.isError
							? null
							: roleQuery.error.message,
					isPending: input.isPersonalWorkspace ? false : roleQuery.isPending,
				}}
			/>
			<CenterAgentMemberMemorySection />
		</>
	);
}
