import type { AuthProfileView } from "@openmeld/schemas/types";
import { lazy, Suspense } from "react";
import { SpaceEntryGate } from "#/components/spaces/space-entry-gate";

const SpaceLanding = lazy(() =>
	import("#/components/spaces/space-landing").then((module) => ({
		default: module.SpaceLanding,
	}))
);

export function HomeConversation(input: {
	spaceId: string;
	profileId: string;
	orgSlug: string;
	accountProfiles: readonly AuthProfileView[];
	isDirectMessage?: boolean;
}) {
	return (
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
						isDirectMessageConversation={input.isDirectMessage}
						orgSlug={input.orgSlug}
						presentation="canvas"
						profileId={input.profileId}
						spaceId={input.spaceId}
					/>
				</Suspense>
			)}
		</SpaceEntryGate>
	);
}
