import { cn } from "@openmeld/ui/lib/utils";

export function FullPagePending(input: {
	className?: string;
	label: string;
	showLabel?: boolean;
}) {
	return (
		<output
			aria-label={input.label}
			aria-live="polite"
			className={cn(
				"flex min-h-svh w-full items-center justify-center gap-3 bg-background px-6 text-foreground",
				input.className
			)}
		>
			<span
				aria-hidden="true"
				className="size-5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground motion-reduce:animate-none"
			/>
			<span
				className={
					input.showLabel ? "truncate text-muted-foreground text-sm" : "sr-only"
				}
			>
				{input.label}
				{input.showLabel ? "…" : null}
			</span>
		</output>
	);
}
