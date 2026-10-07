import { Fragment, type ReactNode } from "react";
import {
	type SpaceMessageProfileMentionPresentation,
	type SpaceMessageProfileMentionProfilesById,
	type SpaceProfileTriggerRenderer,
	splitSpaceMessageProfileMentionText,
} from "./space-message-profile-mention";
import {
	SPACE_PROFILE_MENTION_RELATION_CLASS_NAME,
	SPACE_PROFILE_MENTION_TOKEN_CLASS_NAME,
	SpaceProfileMentionIdentity,
} from "./space-profile-mention-token";

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
		if (input.profile.relation === "wake") {
			relationLabel = "Wake";
		} else if (input.profile.relation === "reference") {
			relationLabel = "Reference";
		} else {
			relationLabel = "Mention only";
		}
	}
	const content = (
		<>
			<SpaceProfileMentionIdentity profile={input.profile} />
			{relationLabel && (
				<span className={SPACE_PROFILE_MENTION_RELATION_CLASS_NAME}>
					{relationLabel}
				</span>
			)}
		</>
	);
	if (!(input.onOpenProfile || input.renderProfileTrigger)) {
		return (
			<span
				className={SPACE_PROFILE_MENTION_TOKEN_CLASS_NAME}
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
			className={`${SPACE_PROFILE_MENTION_TOKEN_CLASS_NAME} cursor-pointer border-0 transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
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
