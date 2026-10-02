"use client";

import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { CenterAgentMemberMemorySection } from "./center-agent-member-memory-section";
import { OrganizationMemoryPolicySection } from "./organization-memory-policy-section";

export function OrganizationMemoryPage() {
	const { currentOrganization } = useAppOrganization();
	return (
		<OrganizationMemoryContent
			isPersonalWorkspace={currentOrganization.isPersonal === true}
			organizationId={currentOrganization.id}
		/>
	);
}

function OrganizationMemoryContent(input: {
	isPersonalWorkspace: boolean;
	organizationId: string;
}) {
	return (
		<>
			<AppPageHeader
				description={
					input.isPersonalWorkspace
						? "Control the two kinds of memory your Center Agent uses in this personal workspace."
						: "Review or erase what this Center Agent remembers about you."
				}
				eyebrow={
					input.isPersonalWorkspace ? "Personal workspace" : "Organization"
				}
				title="Memory"
			/>
			{input.isPersonalWorkspace ? (
				<OrganizationMemoryPolicySection
					isPersonalWorkspace
					organizationId={input.organizationId}
					roleState={{ canManage: true, errorMessage: null, isPending: false }}
				/>
			) : null}
			<CenterAgentMemberMemorySection />
		</>
	);
}
