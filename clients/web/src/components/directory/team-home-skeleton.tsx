import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";

export function TeamHomeSkeleton({
	className,
	label = "Loading team",
}: {
	className?: string;
	label?: string;
}) {
	return (
		<SkeletonRegion className={className} label={label}>
			<div className="space-y-3">
				<Skeleton className="h-4 w-24" />
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					{["first", "second", "third"].map((id) => (
						<div className="space-y-4 rounded-md bg-card p-4" key={id}>
							<div className="flex items-start gap-3">
								<Skeleton className="size-10 shrink-0 rounded-full" />
								<div className="min-w-0 flex-1 space-y-2">
									<Skeleton className="h-4 w-3/4" />
									<Skeleton className="h-3 w-1/2" />
								</div>
							</div>
							<Skeleton className="h-3 w-2/3" />
							<Skeleton className="h-3 w-1/2" />
						</div>
					))}
				</div>
			</div>
		</SkeletonRegion>
	);
}
