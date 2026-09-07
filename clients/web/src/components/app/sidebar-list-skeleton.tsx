import { Skeleton } from "@openmeld/ui/components/skeleton";

const ROW_WIDTHS = ["72%", "56%", "84%", "64%", "76%", "48%"];

export function SidebarListSkeleton({
	label,
	showPreview = false,
	rowCount = ROW_WIDTHS.length,
}: {
	label: string;
	showPreview?: boolean;
	rowCount?: number;
}) {
	return (
		<output className="flex flex-col gap-1">
			<span className="sr-only">{label}</span>
			{ROW_WIDTHS.slice(0, rowCount).map((width) => (
				<div
					className={
						showPreview
							? "flex min-h-12 items-center gap-2 px-2 py-1.5"
							: "flex min-h-10 items-center gap-2 px-2 py-2"
					}
					key={width}
				>
					<Skeleton
						className={`${showPreview ? "size-6" : "size-5"} shrink-0 rounded-full motion-reduce:animate-none`}
					/>
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<div className="flex min-w-0 items-center gap-2">
							<Skeleton
								className="h-3 min-w-0 motion-reduce:animate-none"
								style={{ width }}
							/>
							{showPreview && (
								<Skeleton className="ml-auto h-2.5 w-10 shrink-0 motion-reduce:animate-none" />
							)}
						</div>
						{showPreview ? (
							<Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
						) : null}
					</div>
				</div>
			))}
		</output>
	);
}
