import { Fragment, type ReactNode } from "react";
import {
	SPACE_MESSAGE_PROFILE_MENTION_TOKEN_CLASS_NAME,
	type SpaceMessageProfileMentionPresentation,
	type SpaceMessageProfileMentionProfilesById,
	type SpaceProfileTriggerRenderer,
	splitSpaceMessageProfileMentionText,
} from "./space-message-profile-mention";
import { SpaceProfileIcon } from "./space-profile-icon";

export function SpaceMessageProfileMentionText(input: {
	onOpenProfile?: (profileId: string) => void;
	profilesById: SpaceMessageProfileMentionProfilesById;
	renderProfileTrigger?: SpaceProfileTriggerRenderer;
	renderText?: (text: string) => ReactNode;
	text: string;
}) {
	return (
		<>
			{splitSpaceMessageProfileMentionText(input.text, input.profilesById).map(
				(segment, index) => {
					if (segment.kind === "text") {
						return (
							<Fragment key={`text:${String(index)}`}>
								{input.renderText?.(segment.value) ?? segment.value}
							</Fragment>
						);
					}
					return (
						<SpaceMessageProfileMention
							key={`${segment.profile.profileId}:${String(segment.offset)}`}
							onOpenProfile={input.onOpenProfile}
							profile={segment.profile}
							renderProfileTrigger={input.renderProfileTrigger}
						/>
					);
				}
			)}
		</>
	);
}

export function SpaceMessageProfileMention(input: {
	onOpenProfile?: (profileId: string) => void;
	profile: SpaceMessageProfileMentionPresentation;
	renderProfileTrigger?: SpaceProfileTriggerRenderer;
}) {
	let relationLabel: string | null = null;
	if (input.profile.profileKind === "agent") {
		relationLabel = input.profile.relation === "wake" ? "Wake" : "Reference";
	}
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
			{relationLabel && (
				<span className="shrink-0 border-border border-l pl-1.5 font-medium text-foreground/70 text-xs">
					{relationLabel}
				</span>
			)}
		</>
	);
	if (!(input.onOpenProfile || input.renderProfileTrigger)) {
		return (
			<span
				className={SPACE_MESSAGE_PROFILE_MENTION_TOKEN_CLASS_NAME}
				data-slot="space-message-profile-mention"
			>
				{content}
			</span>
		);
	}
	const trigger = (
		<button
			aria-label={
				relationLabel
					? `Open ${input.profile.profileName} profile (${relationLabel})`
					: `Open ${input.profile.profileName} profile`
			}
			className={`${SPACE_MESSAGE_PROFILE_MENTION_TOKEN_CLASS_NAME} cursor-pointer border-0 transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
			data-slot="space-message-profile-mention"
			onClick={
				input.renderProfileTrigger
					? undefined
					: () => input.onOpenProfile?.(input.profile.profileId)
			}
			type="button"
		>
			{content}
		</button>
	);
	return input.renderProfileTrigger
		? input.renderProfileTrigger(input.profile.profileId, trigger)
		: trigger;
}
