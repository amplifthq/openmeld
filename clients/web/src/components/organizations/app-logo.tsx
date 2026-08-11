import { cn } from "@openmeld/ui/lib/utils";
import type { AppDefinition } from "./app-catalog";

const SIZE_CLASS_NAMES = {
	lg: "size-12 p-2.5",
	md: "size-10 p-2",
	sm: "size-7 p-1.5",
} as const;

export function AppLogo(input: {
	app: Pick<AppDefinition, "logoPath" | "service">;
	className?: string;
	size?: keyof typeof SIZE_CLASS_NAMES;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex shrink-0 items-center justify-center rounded-md border border-black/10 bg-white shadow-xs",
				SIZE_CLASS_NAMES[input.size ?? "md"],
				input.className
			)}
		>
			<img
				alt=""
				className="max-h-full max-w-full object-contain"
				data-testid={`app-logo-${input.app.service}`}
				draggable={false}
				height={48}
				src={input.app.logoPath}
				width={48}
			/>
		</span>
	);
}
