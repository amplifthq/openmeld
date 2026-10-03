import { resolveStatusToneStrongTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { FolderSimpleIcon } from "@phosphor-icons/react";
import type { PointerEventHandler, ReactNode, RefObject } from "react";

type TerminalWindowProps = {
	ariaLabel: string;
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	contentRef?: RefObject<HTMLDivElement | null>;
	overlay?: ReactNode;
	onPointerEnter?: PointerEventHandler<HTMLElement>;
	onPointerLeave?: PointerEventHandler<HTMLElement>;
	rootRef?: RefObject<HTMLElement | null>;
	statusLabel: string;
	titleAfter?: ReactNode;
	titleAfterRef?: RefObject<HTMLDivElement | null>;
	title: string;
};

export function TerminalWindow({
	ariaLabel,
	children,
	className,
	contentClassName,
	contentRef,
	overlay,
	onPointerEnter,
	onPointerLeave,
	rootRef,
	statusLabel,
	titleAfter,
	titleAfterRef,
	title,
}: TerminalWindowProps) {
	return (
		<section
			aria-label={ariaLabel}
			className={cn(
				"group relative flex w-full flex-col overflow-hidden border border-border/70 bg-background text-foreground shadow-2xl outline-none transition motion-reduce:transition-none",
				className
			)}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			ref={rootRef}
		>
			<div aria-hidden className="pointer-events-none absolute inset-0">
				<div className="absolute inset-0 bg-linear-to-br from-card/18 via-transparent to-card/8" />
				<div className="absolute inset-0 bg-linear-to-r from-transparent via-card/10 to-transparent opacity-40" />
			</div>
			{overlay}

			<div className="relative flex items-center justify-between gap-4 border-border/70 border-b bg-card/35 px-5 py-4 sm:px-6">
				<div className="flex min-w-0 flex-1 items-center gap-4">
					<div className="flex items-center gap-2">
						<span className="size-3 rounded-full bg-red-700 dark:bg-red-400" />
						<span className="size-3 rounded-full bg-yellow-700 dark:bg-yellow-400" />
						<span className="size-3 rounded-full bg-green-700 dark:bg-green-400" />
					</div>
					<div className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
						<FolderSimpleIcon
							aria-hidden
							className={cn(
								"size-4 shrink-0 opacity-80",
								resolveStatusToneStrongTextClassName("checking")
							)}
							weight="fill"
						/>
						<p className="shrink-0 font-medium text-sm">{title}</p>
						{titleAfter ? (
							<>
								<span
									aria-hidden
									className="shrink-0 text-muted-foreground/48 text-sm"
								>
									-
								</span>
								<div className="min-w-0 flex-1 truncate" ref={titleAfterRef}>
									{titleAfter}
								</div>
							</>
						) : null}
					</div>
				</div>
				<p className="font-mono text-muted-foreground/70 text-xs uppercase">
					{statusLabel}
				</p>
			</div>

			<div
				className={cn(
					"relative min-h-0 flex-1 overflow-y-auto px-5 py-4",
					contentClassName
				)}
				ref={contentRef}
			>
				{children}
			</div>
		</section>
	);
}
