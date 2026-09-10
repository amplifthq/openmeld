import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { useSurface } from "@openmeld/ui/lib/surface-context";
import { cn } from "@openmeld/ui/lib/utils";
import { XIcon } from "@phosphor-icons/react";
import { SpaceProfileIcon } from "./space-profile-icon";
import type { SpaceMentionPickerItem } from "./use-space-mention-authoring";
import "./space-wake-recommendation.css";

export function SpaceWakeSuggestionToken({
	target,
	ghost = false,
	disabled = false,
	onAccept,
	onDismiss,
	isCenterAgent = false,
}: {
	target: SpaceMentionPickerItem;
	ghost?: boolean;
	disabled?: boolean;
	isCenterAgent?: boolean;
	onAccept: () => void;
	onDismiss?: () => void;
}) {
	const surface = useSurface() + 1;
	return (
		<span
			className={cn(
				"inline-flex max-w-full align-baseline",
				ghost ? "mx-0.5" : "p-3"
			)}
			contentEditable={false}
		>
			<span className="relative inline-flex min-w-0 max-w-full">
				<button
					aria-label={`Accept Wake suggestion for ${target.suggestion.profileName}`}
					className={cn(
						"relative isolate inline-flex h-7 max-w-full items-center gap-1 rounded-md px-1.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						ghost
							? "bg-muted/40 opacity-50 hover:opacity-75"
							: surfaceClasses(surface)
					)}
					data-slot={
						ghost
							? "composer-wake-recommendation"
							: "message-wake-suggestion-token"
					}
					data-wake-pulse={!ghost || undefined}
					disabled={disabled}
					onClick={onAccept}
					onMouseDown={(event) => event.preventDefault()}
					type="button"
				>
					<span aria-hidden="true" className="shrink-0 font-semibold">
						@
					</span>
					<SpaceProfileIcon
						agentControllerRef={target.memberEntry.agentControllerRef}
						avatarImageUrl={target.memberEntry.avatarUrl}
						className="size-4 shrink-0"
						isCenterAgent={isCenterAgent}
						profileId={target.suggestion.profileId}
						profileKind="agent"
						profileName={target.suggestion.profileName}
					/>
					<span className="min-w-0 truncate font-medium">
						{target.suggestion.profileName}
					</span>
					<span className="inline-flex h-6 shrink-0 items-center border-border border-l px-1.5 font-medium text-muted-foreground text-xs">
						{ghost ? "Tab to wake" : "Click to wake"}
					</span>
				</button>
				{onDismiss ? (
					<button
						aria-label="Dismiss Wake suggestion"
						className="absolute -top-2 -right-2 z-10 inline-flex size-5 items-center justify-center rounded-full bg-popover text-muted-foreground shadow-sm ring-1 ring-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						disabled={disabled}
						onClick={(event) => {
							event.stopPropagation();
							onDismiss();
						}}
						type="button"
					>
						<XIcon aria-hidden="true" className="size-3" />
					</button>
				) : null}
			</span>
		</span>
	);
}
