import { cn } from "@openmeld/ui/lib/utils";

export function ReadPausedState(input: {
	className?: string;
	subject: string;
}) {
	return (
		<output
			className={cn(
				"rounded-md border border-border/70 px-4 py-3 text-muted-foreground text-sm",
				input.className
			)}
		>
			Loading is paused. Check your connection to load {input.subject}.
		</output>
	);
}
