import {
	resolveStatusToneSoftTextClassName,
	resolveStatusToneStrongTextClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";

type TerminalLineVariant =
	| "accent"
	| "command"
	| "default"
	| "label"
	| "muted"
	| "success";

type TerminalPrefixTone = "accent" | "muted" | "success";

type TerminalLineProps = {
	className?: string;
	prefix?: string;
	prefixTone?: TerminalPrefixTone;
	suffix?: string;
	text: string;
	variant?: TerminalLineVariant;
};

const lineVariantClassNames: Record<TerminalLineVariant, string> = {
	accent: cn(resolveStatusToneSoftTextClassName("checking"), "opacity-[0.92]"),
	command: "font-medium text-foreground",
	default: "text-foreground/84",
	label: "font-medium text-foreground",
	muted: "text-muted-foreground",
	success: cn(resolveStatusToneSoftTextClassName("ready"), "opacity-[0.88]"),
};

const prefixToneClassNames: Record<TerminalPrefixTone, string> = {
	accent: "text-pink-700 dark:text-pink-400",
	muted: "text-muted-foreground/80",
	success: cn(resolveStatusToneStrongTextClassName("ready"), "opacity-90"),
};

export function TerminalLine({
	className,
	prefix,
	prefixTone = "muted",
	suffix,
	text,
	variant = "default",
}: TerminalLineProps) {
	return (
		<div
			className={cn(
				"motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 flex items-baseline gap-3 font-mono text-[0.84rem] leading-[1.65] motion-safe:animate-in motion-safe:duration-500 motion-reduce:animate-none sm:text-[0.9rem]",
				className
			)}
		>
			{prefix ? (
				<span
					className={cn(
						"w-5 shrink-0 text-center font-medium",
						prefixToneClassNames[prefixTone]
					)}
				>
					{prefix}
				</span>
			) : null}
			<span
				className={cn(
					"wrap-break-word min-w-0 whitespace-pre-wrap",
					lineVariantClassNames[variant]
				)}
			>
				{text}
			</span>
			{suffix ? (
				<span className="ml-auto shrink-0 text-muted-foreground/70 text-sm">
					{suffix}
				</span>
			) : null}
		</div>
	);
}
