import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import {
	AgentConfigurationGrid,
	AgentConfigurationReadoutCard,
} from "#/components/profiles/agent-configuration-card";

const CONFIGURATION_LABELS = [
	"Owner",
	"Model",
	"Collaboration mode",
	"Permissions",
] as const;

export function AgentUsageSkeleton() {
	return (
		<SkeletonRegion label="Loading usage limits">
			<div className="flex min-w-0 items-center gap-4">
				<Skeleton className="size-16 shrink-0 rounded-full" />
				<div className="min-w-0 flex-1 space-y-2">
					<Skeleton className="h-4 w-28 max-w-full" />
					<Skeleton className="h-3 w-36 max-w-full" />
					<Skeleton className="h-3 w-24 max-w-full" />
				</div>
			</div>
		</SkeletonRegion>
	);
}

export function AgentConfigurationSkeletonCard({ label }: { label: string }) {
	return (
		<AgentConfigurationReadoutCard itemId={`loading-${label}`} label={label}>
			<SkeletonRegion label={`Loading ${label.toLowerCase()}`}>
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="mt-3 h-3 w-1/2" />
			</SkeletonRegion>
		</AgentConfigurationReadoutCard>
	);
}

export function AgentDetailSkeleton() {
	return (
		<SkeletonRegion
			className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
			label="Loading Agent details"
		>
			<div className="space-y-6">
				<div className="flex min-w-0 items-start gap-4">
					<Skeleton className="size-24 shrink-0" />
					<div className="min-w-0 flex-1 space-y-3 pt-1">
						<Skeleton className="h-6 w-48 max-w-full" />
						<Skeleton className="h-4 w-64 max-w-full" />
						<Skeleton className="h-4 w-32" />
					</div>
				</div>
				<div className="space-y-3">
					<p className="font-medium text-sm">Current activity</p>
					<Skeleton className="h-4 w-48" />
				</div>
				<AgentConfigurationGrid>
					{CONFIGURATION_LABELS.map((label) => (
						<AgentConfigurationSkeletonCard key={label} label={label} />
					))}
					<AgentConfigurationReadoutCard
						itemId="loading-usage"
						label="Usage limits"
					>
						<AgentUsageSkeleton />
					</AgentConfigurationReadoutCard>
				</AgentConfigurationGrid>
			</div>
		</SkeletonRegion>
	);
}

export function AgentListSkeleton() {
	return (
		<SkeletonRegion
			className="px-[var(--app-page-inline-padding)] py-6"
			label="Loading Agents"
		>
			<div className="space-y-4">
				<Skeleton className="h-8 w-48" />
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{["first", "second", "third"].map((id) => (
						<div className="space-y-4 rounded-md bg-card p-4" key={id}>
							<Skeleton className="size-12" />
							<Skeleton className="h-4 w-2/3" />
							<Skeleton className="h-3 w-1/2" />
						</div>
					))}
				</div>
			</div>
		</SkeletonRegion>
	);
}
