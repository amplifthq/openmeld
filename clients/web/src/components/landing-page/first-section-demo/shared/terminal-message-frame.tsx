import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";

type TerminalMessageFrameProps = {
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	testId?: string;
};

export function TerminalMessageFrame({
	children,
	className,
	contentClassName,
	testId,
}: TerminalMessageFrameProps) {
	return (
		<div
			className={cn("bg-card/70 px-3.5 py-2.5 sm:px-4 sm:py-3", className)}
			data-testid={testId}
		>
			<div className={cn("space-y-1", contentClassName)}>{children}</div>
		</div>
	);
}
