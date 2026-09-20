import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";

// Kept outside lazy panels: reusing a fallback must not eagerly import its panel.
const ITEMS = ["first", "second", "third"] as const;

export function SpaceTasksSkeleton() {
	return (
		<SkeletonRegion className="p-4 sm:p-6" label="Loading Tasks">
			<div className="grid gap-4 md:grid-cols-3">
				{ITEMS.map((id) => (
					<div key={id}>
						<Skeleton className="mb-3 h-8 w-32" />
						<Skeleton className="h-24 w-full rounded-lg" />
					</div>
				))}
			</div>
		</SkeletonRegion>
	);
}

export function SpaceFilesSkeleton({
	className,
	showToolbar = false,
}: {
	className?: string;
	showToolbar?: boolean;
}) {
	return (
		<SkeletonRegion className={className} label="Loading files">
			{showToolbar ? (
				<div className="mb-5 flex justify-between gap-4">
					<Skeleton className="h-7 w-32" />
					<Skeleton className="h-7 w-20" />
				</div>
			) : null}
			<div className="grid gap-2">
				{ITEMS.map((id) => (
					<div className="flex h-14 items-center gap-3 rounded-md p-3" key={id}>
						<Skeleton className="size-8 shrink-0" />
						<div className="min-w-0 flex-1 space-y-2">
							<Skeleton className="h-3 w-1/3" />
							<Skeleton className="h-2.5 w-1/2" />
						</div>
					</div>
				))}
			</div>
		</SkeletonRegion>
	);
}

export function SpaceGraphSkeleton() {
	return (
		<SkeletonRegion className="h-full min-h-64 p-6" label="Loading graph">
			<Skeleton className="h-7 w-32" />
			<div className="mx-auto mt-8 grid max-w-lg grid-cols-2 gap-8">
				{ITEMS.map((id) => (
					<Skeleton className="h-16 w-full" key={id} />
				))}
			</div>
		</SkeletonRegion>
	);
}
