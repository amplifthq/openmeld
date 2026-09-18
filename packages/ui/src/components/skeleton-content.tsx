import type { ReactNode } from "react";
import { Skeleton } from "#components/skeleton";
import { cn } from "#lib/utils";

/** One announcement per region; placeholder shapes are not controls or content. */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <output aria-label={label} className={cn("block", className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </output>
  );
}

const ROW_IDS = ["first", "second", "third", "fourth"] as const;

export function SkeletonRows({
  label,
  className,
  rows = 3,
}: {
  label: string;
  className?: string;
  rows?: 1 | 2 | 3 | 4;
}) {
  return (
    <SkeletonRegion className={className} label={label}>
      <div className="space-y-4">
        {ROW_IDS.slice(0, rows).map((id) => (
          <div className="flex min-w-0 items-center gap-3" key={id}>
            <Skeleton className="size-9 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5 max-w-48" />
              <Skeleton className="h-3 w-3/4 max-w-80" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function SkeletonForm({
  label,
  className,
  fields = 3,
}: {
  label: string;
  className?: string;
  fields?: 1 | 2 | 3 | 4;
}) {
  return (
    <SkeletonRegion className={className} label={label}>
      <div className="space-y-5">
        {ROW_IDS.slice(0, fields).map((id) => (
          <div className="space-y-2" key={id}>
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
