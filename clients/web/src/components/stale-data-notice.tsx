import { cn } from "@openmeld/ui/lib/utils";

export function StaleDataNotice(input: {
	className?: string;
	label: string;
	onRetry: () => void;
}) {
	return (
		<div
			className={cn(
				"mx-2 mt-2 flex min-h-9 items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-2",
				input.className
			)}
			role="alert"
		>
			<p className="min-w-0 text-muted-foreground text-xs">{input.label}</p>
			<button
				className="shrink-0 rounded-sm font-medium text-foreground text-xs underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
				onClick={input.onRetry}
				type="button"
			>
				Try again
			</button>
		</div>
	);
}
