import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { cn } from "@openmeld/ui/lib/utils";
import type { PluginDefinition } from "./plugin-catalog";

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

const MESSAGE_CHANNEL_PADDING_CLASS_NAMES = {
	lg: "p-1.5",
	md: "p-1",
	sm: "p-0.5",
} as const;

export function AppLogo(input: {
	app: Pick<PluginDefinition, "logoPath" | "service">;
	className?: string;
	muted?: boolean;
	size?: keyof typeof SIZE_CLASS_NAMES;
	surfaceLevel?: number;
}) {
	const size = input.size ?? "md";
	const isMessageChannel =
		input.app.service === "slack" ||
		input.app.service === "lark" ||
		input.app.service === "feishu";
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex shrink-0 items-center justify-center rounded-md border",
				input.surfaceLevel !== undefined
					? cn("border-transparent", surfaceClasses(input.surfaceLevel))
					: "border-black/10 bg-white shadow-xs",
				isMessageChannel && input.surfaceLevel === undefined
					? "dark:border-0 dark:bg-transparent dark:shadow-none"
					: null,
				SIZE_CLASS_NAMES[size],
				isMessageChannel
					? MESSAGE_CHANNEL_PADDING_CLASS_NAMES[size]
					: DEFAULT_PADDING_CLASS_NAMES[size],
				input.className
			)}
		>
			<img
				alt=""
				className={cn(
					"max-h-full max-w-full object-contain",
					input.surfaceLevel !== undefined &&
						(input.app.service === "github" || input.app.service === "linear")
						? "dark:invert"
						: null,
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
