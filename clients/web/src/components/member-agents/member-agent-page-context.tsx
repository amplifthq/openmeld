import { formatHarnessDisplayName } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { PlusIcon } from "@phosphor-icons/react";
import { createContext, type ReactNode, use } from "react";
import { SensitiveOperationAuditSection } from "#/components/sensitive-operations/sensitive-operation-audit-section";
import type { MemberAgentDirectoryRow } from "./member-agent-directory-model";

type MemberAgentPage = {
	row: MemberAgentDirectoryRow;
	/** Opens Create Agent pinned to this Agent's harness; absent for hosted. */
	onCreateProfile?: () => void;
};

const MemberAgentPageContext = createContext<MemberAgentPage | null>(null);

/**
 * Marks a Profile page as the page of its MemberAgent: the Profile detail is
 * the Agent page, with the Agent's own actions and history added to it.
 */
export function MemberAgentPageProvider(input: {
	value: MemberAgentPage | null;
	children: ReactNode;
}) {
	return (
		<MemberAgentPageContext value={input.value}>
			{input.children}
		</MemberAgentPageContext>
	);
}

/** "New Claude Code": another Profile of this Agent's harness. */
export function MemberAgentNewProfileButton() {
	const page = use(MemberAgentPageContext);
	if (!page?.onCreateProfile) {
		return null;
	}
	return (
		<Button
			onClick={page.onCreateProfile}
			size="sm"
			type="button"
			variant="secondary"
		>
			<PlusIcon aria-hidden="true" data-icon="inline-start" />
			New {formatHarnessDisplayName(page.row.harnessKind)}
		</Button>
	);
}

/** The Agent's sensitive changes across all of its Profiles. */
export function MemberAgentSensitiveChanges() {
	const page = use(MemberAgentPageContext);
	if (!page) {
		return null;
	}
	const { row } = page;
	// The page already names the Agent; only several Profiles need telling apart.
	return (
		<SensitiveOperationAuditSection
			memberAgentId={row.memberAgentId}
			profileNames={
				new Map(
					row.profiles.length > 1
						? row.profiles.map((profile) => [
								profile.openMeldProfileId,
								profile.profileName,
							])
						: []
				)
			}
		/>
	);
}
