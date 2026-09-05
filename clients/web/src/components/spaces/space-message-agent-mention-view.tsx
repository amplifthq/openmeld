import { Fragment, type ReactNode } from "react";
import {
	SPACE_MESSAGE_AGENT_MENTION_TOKEN_CLASS_NAME,
	type SpaceAgentProfileTriggerRenderer,
	type SpaceMessageAgentMentionPresentation,
	type SpaceMessageAgentMentionProfilesById,
	splitSpaceMessageAgentMentionText,
} from "./space-message-agent-mention";
import { SpaceProfileIcon } from "./space-profile-icon";

export function SpaceMessageAgentMentionText(input: {
	onOpenAgentProfile?: (profileId: string) => void;
	profilesById: SpaceMessageAgentMentionProfilesById;
	renderAgentProfileTrigger?: SpaceAgentProfileTriggerRenderer;
	renderText?: (text: string) => ReactNode;
	text: string;
}) {
	return (
		<>
			{splitSpaceMessageAgentMentionText(input.text, input.profilesById).map(
				(segment, index) => {
					if (segment.kind === "text") {
						return (
							<Fragment key={`text:${String(index)}`}>
								{input.renderText?.(segment.value) ?? segment.value}
							</Fragment>
						);
					}
					return (
						<SpaceMessageAgentMention
							key={`${segment.profile.profileId}:${String(segment.offset)}`}
							onOpenAgentProfile={input.onOpenAgentProfile}
							profile={segment.profile}
							renderAgentProfileTrigger={input.renderAgentProfileTrigger}
						/>
					);
				}
			)}
		</>
	);
}

export function SpaceMessageAgentMention(input: {
	onOpenAgentProfile?: (profileId: string) => void;
	profile: SpaceMessageAgentMentionPresentation;
	renderAgentProfileTrigger?: SpaceAgentProfileTriggerRenderer;
}) {
	const relationLabel =
		input.profile.relation === "wake" ? "Wake" : "Reference";
	const content = (
		<>
			<span aria-hidden="true" className="shrink-0 font-semibold">
				@
			</span>
			<SpaceProfileIcon
				agentControllerRef={input.profile.agentControllerRef}
				avatarImageUrl={input.profile.avatarImageUrl}
				className="inline-flex"
				isCenterAgent={input.profile.isCenterAgent}
				profileId={input.profile.profileId}
				profileKind={input.profile.profileKind}
				profileName={input.profile.profileName}
				size="inline"
			/>
			<strong className="min-w-0 truncate font-semibold">
				{input.profile.profileName}
			</strong>
			<span className="shrink-0 border-border border-l pl-1.5 font-medium text-muted-foreground text-xs">
				{relationLabel}
			</span>
		</>
	);
	if (!(input.onOpenAgentProfile || input.renderAgentProfileTrigger)) {
		return (
			<span
				className={SPACE_MESSAGE_AGENT_MENTION_TOKEN_CLASS_NAME}
				data-slot="space-message-agent-mention"
			>
				{content}
			</span>
		);
	}
	const trigger = (
		<button
			aria-label={`Open ${input.profile.profileName} profile (${relationLabel})`}
			className={`${SPACE_MESSAGE_AGENT_MENTION_TOKEN_CLASS_NAME} cursor-pointer border-0 transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
			data-slot="space-message-agent-mention"
			onClick={
				input.renderAgentProfileTrigger
					? undefined
					: () => input.onOpenAgentProfile?.(input.profile.profileId)
			}
			type="button"
		>
			{content}
		</button>
	);
	return input.renderAgentProfileTrigger
		? input.renderAgentProfileTrigger(input.profile.profileId, trigger)
		: trigger;
}
