import type { AuthProfileView } from "@openmeld/schemas/types";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
}) {
	const container = useRef<HTMLDivElement>(null);
	const [availableWidth, setAvailableWidth] = useState(0);
	useEffect(() => {
		if (!container.current) {
			return;
		}
		const observer = new ResizeObserver(([entry]) =>
			setAvailableWidth(entry.contentRect.width)
		);
		observer.observe(container.current);
		return () => observer.disconnect();
	}, []);
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col" ref={container}>
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
							availableWidth={availableWidth}
							initialSpaceView={input.initialView}
							onSpaceViewCommitted={input.onViewChange}
							orgSlug={input.orgSlug}
							presentation="full"
							profileId={input.profileId}
							spaceId={input.spaceId}
						/>
					</Suspense>
				)}
			</SpaceEntryGate>
		</div>
	);
}
