import { cn } from "@openmeld/ui/lib/utils";

type TerminalCommandTextProps = {
	className?: string;
	command: string;
};

export function TerminalCommandText({
	className,
	command,
}: TerminalCommandTextProps) {
	return (
		<span
			className={cn(
				"inline-flex min-w-0 items-baseline whitespace-nowrap font-medium text-foreground",
				className
			)}
		>
			{command}
		</span>
	);
}
