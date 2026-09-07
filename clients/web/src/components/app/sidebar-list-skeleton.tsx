import { Skeleton } from "@openmeld/ui/components/skeleton";

const ROW_WIDTHS = ["72%", "56%", "84%", "64%", "76%", "48%"];

export function SidebarListSkeleton({
	label,
	showPreview = false,
}: {
	label: string;
	showPreview?: boolean;
}) {
	return (
		<output className="flex flex-col gap-1">
			<span className="sr-only">{label}</span>
			{ROW_WIDTHS.map((width) => (
				<div className="flex min-h-10 items-center gap-2 px-2 py-2" key={width}>
					<Skeleton className="size-5 shrink-0 rounded-full motion-reduce:animate-none" />
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Skeleton
							className="h-3 motion-reduce:animate-none"
							style={{ width }}
						/>
						{showPreview ? (
							<Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
						) : null}
					</div>
				</div>
			))}
		</output>
	);
}
