import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";

export function ComputerCardsSkeleton() {
	return (
		<SkeletonRegion label="Loading computers">
			<div className="grid gap-3 sm:grid-cols-2">
				{["first", "second"].map((id) => (
					<div className="space-y-4 rounded-md bg-card p-4" key={id}>
						<div className="flex items-start gap-3">
							<Skeleton className="size-8 shrink-0" />
							<div className="min-w-0 flex-1 space-y-2">
								<Skeleton className="h-4 w-3/4" />
								<Skeleton className="h-3 w-1/2" />
							</div>
						</div>
						<Skeleton className="h-3 w-2/3" />
					</div>
				))}
			</div>
		</SkeletonRegion>
	);
}
