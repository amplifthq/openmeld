import type { AuthProfileView } from "@openmeld/schemas/types";
import { lazy, Suspense } from "react";
import { SpaceEntryGate } from "#/components/spaces/space-entry-gate";
import type { SpaceView } from "#/components/spaces/space-view";

const SpaceLanding = lazy(() =>
	import("#/components/spaces/space-landing").then((module) => ({
		default: module.SpaceLanding,
	}))
);

export function DeskSpace(input: {
	spaceId: string;
	profileId: string;
	orgSlug: string;
	accountProfiles: readonly AuthProfileView[];
	onViewChange?: (view: SpaceView) => void;
	initialView?: SpaceView;
	compact?: boolean;
	readingEnabled?: boolean;
	focusSignalId?: string;
	focusThreadRootSignalId?: string;
}) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<SpaceEntryGate
				openMeldProfileId={input.profileId}
				renderFrame={(content) => <div className="m-auto p-4">{content}</div>}
				signInHref="/login"
				spaceId={input.spaceId}
			>
				{() => (
					<Suspense
						fallback={
							<output className="p-4 text-muted-foreground text-sm">
								Loading conversation…
							</output>
						}
					>
						<SpaceLanding
							accountProfiles={input.accountProfiles}
							initialFocusSignalId={input.focusSignalId}
							initialFocusThreadRootSignalId={input.focusThreadRootSignalId}
							initialSpaceView={input.initialView}
							membersPresentation="inline"
							onSpaceViewCommitted={input.onViewChange}
							orgSlug={input.orgSlug}
							presentation={input.compact ? "compact" : "full"}
							profileId={input.profileId}
							readingEnabled={input.readingEnabled}
							spaceId={input.spaceId}
						/>
					</Suspense>
				)}
			</SpaceEntryGate>
		</div>
	);
}
