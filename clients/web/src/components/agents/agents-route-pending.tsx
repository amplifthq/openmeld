"use client";

import { Skeleton } from "@openmeld/ui/components/skeleton";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { ProfilesSectionLayout } from "#/components/profiles/profiles-section-layout";
import { APP_SIDEBAR_DEFAULT_STATES } from "#/lib/sidebar-width-cookie";

const PROFILE_SKELETON_IDS = ["first", "second", "third"] as const;

export function AgentsRoutePendingPage() {
	return (
		<AppFullWidthLayout
			initialOuterSidebarState={APP_SIDEBAR_DEFAULT_STATES.outer}
		>
			<output aria-label="Loading Agents" className="sr-only">
				Loading Agents
			</output>
			<ProfilesSectionLayout
				action={<Skeleton className="h-8 w-28" />}
				description="Agents are your AI teammates. See whether each one is ready to work in Spaces."
				title="Agents"
			>
				<span className="sr-only">Loading Agents.</span>
				<div className="grid gap-3 lg:grid-cols-2">
					{PROFILE_SKELETON_IDS.map((id) => (
						<Skeleton className="min-h-40 w-full" key={id} />
					))}
				</div>
			</ProfilesSectionLayout>
		</AppFullWidthLayout>
	);
}
