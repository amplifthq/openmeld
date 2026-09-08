import { Skeleton } from "@openmeld/ui/components/skeleton";

// Presentation only: callers own history readiness, the content rail, and composer.
export function SpaceConversationSkeleton() {
	return (
		<div aria-hidden="true" className="flex w-full flex-col gap-5">
			<div className="flex items-start gap-3">
				<Skeleton className="size-8 shrink-0 rounded-full motion-reduce:animate-none" />
				<div className="flex min-w-0 max-w-xl flex-1 flex-col gap-2">
					<Skeleton className="h-3 w-24 motion-reduce:animate-none" />
					<Skeleton className="h-3 w-full motion-reduce:animate-none" />
					<Skeleton className="h-3 w-5/6 motion-reduce:animate-none" />
					<Skeleton className="h-3 w-2/3 motion-reduce:animate-none" />
				</div>
			</div>
			<div className="flex justify-end">
				<Skeleton className="h-10 w-2/3 max-w-lg rounded-lg motion-reduce:animate-none" />
			</div>
			<div className="flex items-start gap-3">
				<Skeleton className="size-8 shrink-0 rounded-full motion-reduce:animate-none" />
				<div className="flex w-3/4 min-w-0 max-w-2xl flex-col gap-3">
					<Skeleton className="h-3 w-28 motion-reduce:animate-none" />
					<Skeleton className="h-3 w-full motion-reduce:animate-none" />
					<Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
				</div>
			</div>
		</div>
	);
}
