import { resolveStatusToneStrongTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";

type TerminalSectionFrameProps = {
	bodyClassName?: string;
	children: ReactNode;
	className?: string;
	icon?: string;
	title: string;
};

export function TerminalSectionFrame({
	bodyClassName,
	children,
	className,
	icon,
	title,
}: TerminalSectionFrameProps) {
	return (
		<section className={cn(className)}>
			<div className="flex items-center gap-3 font-mono text-[0.84rem] leading-[1.65] sm:text-[0.9rem]">
				{icon ? (
					<span
						className={cn(
							"w-5 shrink-0 text-center opacity-[0.86]",
							resolveStatusToneStrongTextClassName("checking")
						)}
					>
						{icon}
					</span>
				) : null}
				<span className="text-foreground/92">{title}</span>
				<span className="h-px flex-1 bg-border/70" />
			</div>
			<div
				className={cn(
					"mt-2.5 border border-border/70 bg-card/70 px-3.5 py-2.5 font-mono text-[0.84rem] leading-[1.65] sm:mt-3 sm:px-4 sm:py-3 sm:text-[0.9rem]",
					bodyClassName
				)}
			>
				{children}
			</div>
		</section>
	);
}
