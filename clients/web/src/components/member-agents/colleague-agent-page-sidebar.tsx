import { harnessKindFromAgentControllerRef } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ChatCircleTextIcon } from "@phosphor-icons/react";
import {
	resolveAgentChatActionLabel,
	resolveColleagueRequestSpaceId,
	useColleagueAgentAccess,
	useOpenColleagueRequestSpace,
} from "#/components/agent-access/agent-access-indicator";
import {
	formatPublicWakeabilityReason,
	usePublicWakeabilityReason,
} from "#/lib/agents/agent-viewer-access";
import { useColleagueAccessState } from "#/lib/agents/colleague-access-state";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { useOpenDirectMessage } from "#/lib/spaces/use-open-direct-message";
import { formatMemberAgentDisplayName } from "./member-agent-display-name";
import { MemberAgentPageSidebar } from "./member-agent-page-sidebar";

/**
 * The sidebar of a colleague's Agent page: the same Active/Archived chats as
 * the viewer's own Agent, listing only the viewer's chats with it. The owner's
 * MemberAgent is not readable, so its Profiles are the owner's Profiles of the
 * same harness. Undefined for the viewer's own Profiles.
 */
export function ColleagueAgentPageSidebar(input: {
	selectedProfileId: string | null;
	profiles: readonly AuthProfileView[];
	agentControllerRefByProfileId: ReadonlyMap<string, string | null>;
	ownerName: string;
	onSelectProfile: (profileId: string) => void;
}) {
	const { currentUserId } = useAppOrganization();
	const selected = input.profiles.find(
		(profile) => profile.openMeldProfileId === input.selectedProfileId
	);
	if (!selected?.ownerUserId || selected.ownerUserId === currentUserId) {
		return null;
	}
	const harnessKind = harnessKindFromAgentControllerRef(
		input.agentControllerRefByProfileId.get(selected.openMeldProfileId) ?? null
	);
	const siblings = harnessKind
		? input.profiles.filter(
				(profile) =>
					profile.ownerUserId === selected.ownerUserId &&
					harnessKindFromAgentControllerRef(
						input.agentControllerRefByProfileId.get(
							profile.openMeldProfileId
						) ?? null
					) === harnessKind
			)
		: [selected];
	const displayName = harnessKind
		? formatMemberAgentDisplayName({ ownerName: input.ownerName, harnessKind })
		: selected.profileName;
	return (
		<MemberAgentPageSidebar
			activeProfileId={selected.openMeldProfileId}
			defaultProfileId={siblings[0]?.openMeldProfileId ?? null}
			displayName={displayName}
			emptyAction={<ColleagueAgentChatButton profile={selected} />}
			harnessKind={harnessKind}
			memberAgentId={null}
			onSelectProfile={input.onSelectProfile}
			profiles={siblings}
		/>
	);
}

/** The Agent page header's chat action, full width in the empty sidebar. */
function ColleagueAgentChatButton(input: { profile: AuthProfileView }) {
	const { currentOrganization } = useAppOrganization();
	const directMessage = useOpenDirectMessage({
		organizationId: currentOrganization.id,
		orgSlug: currentOrganization.slug,
	});
	const access = useColleagueAgentAccess({
		ownerUserId: input.profile.ownerUserId ?? null,
		profileId: input.profile.openMeldProfileId,
	});
	const reason = usePublicWakeabilityReason({
		enabled: true,
		profileId: input.profile.openMeldProfileId,
	});
	// An offline computer still takes messages; they wait for it.
	const unavailable =
		reason && reason.code !== "computer_offline"
			? formatPublicWakeabilityReason(reason)
			: null;
	const colleagueAccess = useColleagueAccessState({
		ownerUserId: input.profile.ownerUserId ?? null,
		profileId: input.profile.openMeldProfileId,
	});
	const openRequestSpace = useOpenColleagueRequestSpace();
	// The label depends on the request state; wait for it instead of flashing.
	if (access?.kind === "asks_owner" && colleagueAccess === null) {
		return null;
	}
	const requestSpaceId = resolveColleagueRequestSpaceId(colleagueAccess);
	const label = resolveAgentChatActionLabel({
		access,
		colleagueAccess,
		profileName: input.profile.profileName,
	});
	const button = (
		<Button
			className="w-full"
			disabled={
				unavailable !== null ||
				directMessage.pendingProfileId === input.profile.openMeldProfileId
			}
			onClick={() => {
				if (requestSpaceId) {
					openRequestSpace(requestSpaceId);
					return;
				}
				directMessage
					.open(input.profile.openMeldProfileId)
					.catch(console.error);
			}}
			size="sm"
			type="button"
		>
			<ChatCircleTextIcon aria-hidden="true" data-icon="inline-start" />
			{label}
		</Button>
	);
	return unavailable ? (
		<TooltipHint content={`Can’t start work right now: ${unavailable}.`}>
			<span className="flex w-full">{button}</span>
		</TooltipHint>
	) : (
		button
	);
}
