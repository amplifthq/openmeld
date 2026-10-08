"use client";

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
			<header className="space-y-1">
				<h2 className="font-medium text-base">Memory</h2>
				<p className="text-muted-foreground text-sm">
					{input.isPersonalWorkspace
						? "Control the two kinds of memory your Center Agent uses in this personal workspace."
						: "Review or erase what this Center Agent remembers about you."}
				</p>
			</header>
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
