import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import { SpaceProfileIcon } from "./space-profile-icon";

// Keep component-owned avatars out of Typeset's prose image spacing rules.
export const SPACE_PROFILE_MENTION_TOKEN_CLASS_NAME =
	"not-typeset inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted px-1.5 align-baseline text-foreground ring-1 ring-border/70";

export const SPACE_PROFILE_MENTION_NAME_CLASS_NAME =
	"min-w-0 truncate font-semibold";

export const SPACE_PROFILE_MENTION_RELATION_CLASS_NAME =
	"shrink-0 border-border border-l pl-1.5 font-medium text-foreground/70 text-xs";

export function SpaceProfileMentionIdentity({
	children,
	muted = false,
	profile,
}: {
	children?: ReactNode;
	muted?: boolean;
	profile: SpaceCollaborationProfilePresentation;
}) {
	return (
		<>
			<span
				aria-hidden="true"
				className="shrink-0 font-semibold"
				data-slot="space-profile-mention-token-at"
			>
				@
			</span>
			<span
				className={cn("inline-flex shrink-0", muted && "opacity-50 grayscale")}
				data-slot="space-profile-mention-token-icon"
			>
				<SpaceProfileIcon {...profile} className="inline-flex" size="inline" />
			</span>
			{children ?? (
				<strong className={SPACE_PROFILE_MENTION_NAME_CLASS_NAME}>
					{profile.profileName}
				</strong>
			)}
		</>
	);
}
