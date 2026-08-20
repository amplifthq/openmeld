import { cn } from "@openmeld/ui/lib/utils";
import type { AppDefinition } from "./app-catalog";

const SIZE_CLASS_NAMES = {
	lg: "size-12",
	md: "size-10",
	sm: "size-7",
} as const;

const DEFAULT_PADDING_CLASS_NAMES = {
	lg: "p-2.5",
	md: "p-2",
	sm: "p-1.5",
} as const;

const SLACK_PADDING_CLASS_NAMES = {
	lg: "p-1.5",
	md: "p-1",
	sm: "p-0.5",
} as const;

export function AppLogo(input: {
	app: Pick<AppDefinition, "logoPath" | "service">;
	className?: string;
	muted?: boolean;
	size?: keyof typeof SIZE_CLASS_NAMES;
}) {
	const size = input.size ?? "md";
	const usesThemeAwareChannelSurface =
		input.app.service === "slack" ||
		input.app.service === "lark" ||
		input.app.service === "feishu";
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex shrink-0 items-center justify-center rounded-md border border-black/10 bg-white shadow-xs",
				usesThemeAwareChannelSurface
					? "dark:border-white/10 dark:bg-muted/50"
					: null,
				SIZE_CLASS_NAMES[size],
				input.app.service === "slack"
					? SLACK_PADDING_CLASS_NAMES[size]
					: DEFAULT_PADDING_CLASS_NAMES[size],
				input.className
			)}
		>
			<img
				alt=""
				className={cn(
					"max-h-full max-w-full object-contain",
					input.muted ? "opacity-50 grayscale" : null
				)}
				data-testid={`app-logo-${input.app.service}`}
				draggable={false}
				height={48}
				src={input.app.logoPath}
				width={48}
			/>
		</span>
	);
}
