import type { AuthProfileView } from "@openmeld/schemas/types";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { lazy, Suspense } from "react";
import { SpaceEntryGate } from "./space-entry-gate";

const SpaceLanding = lazy(() =>
	import("./space-landing").then((module) => ({ default: module.SpaceLanding }))
);

export function SpaceDirectoryPreview(input: {
	accountProfiles: readonly AuthProfileView[];
	space: { spaceId: string; name: string } | null;
	profileId: string;
	orgSlug: string;
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
					<div className="flex min-h-0 flex-1 flex-col [&_[data-slot=app-main-content-header]]:pr-10">
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
							{() => (
								<Suspense
									fallback={
										<output className="p-8 text-muted-foreground text-sm">
											Loading conversation…
										</output>
									}
								>
									<SpaceLanding
										accountProfiles={input.accountProfiles}
										orgSlug={input.orgSlug}
										profileId={input.profileId}
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
