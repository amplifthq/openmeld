import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import { lazy, Suspense } from "react";
import { SpaceConversationSkeleton } from "./space-conversation-skeleton";
import { SpaceEntryGate } from "./space-entry-gate";

const SpaceReadOnlyConversation = lazy(() =>
	import("./public-space-page").then((module) => ({
		default: module.SpaceReadOnlyConversation,
	}))
);

export function SpaceDirectoryPreview(input: {
	space: { spaceId: string; name: string } | null;
	profileId: string;
	onJoinSpace: () => void;
	joinPending: boolean;
	onClose: () => void;
}) {
	const space = input.space;
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					input.onClose();
				}
			}}
			open={input.space !== null}
		>
			<DialogContent
				aria-describedby={undefined}
				className="flex h-[85dvh] w-[min(72rem,calc(100vw-2rem))] max-w-none flex-col overflow-hidden p-0 sm:max-w-none"
			>
				<DialogTitle className="sr-only">
					Preview {input.space?.name}
				</DialogTitle>
				{space && (
					<div className="flex min-h-0 flex-1 flex-col [&_[data-slot=space-window-header]]:pr-12 sm:[&_[data-slot=space-window-header]]:pr-10 lg:[&_[data-slot=space-window-header]]:pr-4">
						<SpaceEntryGate
							key={space.spaceId}
							openMeldProfileId={input.profileId}
							renderFrame={(content) => (
								<div className="flex h-full items-center justify-center p-8">
									{content}
								</div>
							)}
							signInHref="/login"
							spaceId={space.spaceId}
						>
							{(resolution) => (
								<Suspense
									fallback={
										<SkeletonRegion
											className="p-8"
											label="Loading conversation"
										>
											<SpaceConversationSkeleton />
										</SkeletonRegion>
									}
								>
									<SpaceReadOnlyConversation
										entryResolution={resolution}
										joinPending={input.joinPending}
										onJoinSpace={input.onJoinSpace}
										spaceId={space.spaceId}
									/>
								</Suspense>
							)}
						</SpaceEntryGate>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
