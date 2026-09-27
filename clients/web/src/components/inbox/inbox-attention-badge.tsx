import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";

export function InboxAttentionBadge({
	count,
	tone,
	indicatorTone,
	placement = "overlay",
}: {
	count: number | null;
	tone: "danger" | "warning" | null;
	indicatorTone?: "danger" | "warning" | "unread" | null;
	placement?: "overlay" | "trailing";
}) {
	if (indicatorTone === "unread") {
		return (
			<span
				aria-hidden="true"
				className={cn(
					"status-dot pointer-events-none shrink-0 bg-unread",
					placement === "overlay" && "absolute end-1 top-1"
				)}
			/>
		);
	}
	if (count === null || count === 0) {
		return null;
	}
	const formattedCount = count > 99 ? "99+" : count;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"pointer-events-none h-3 min-w-3 shrink-0 rounded-full px-0.5 text-center font-semibold text-[8px] text-white tabular-nums leading-3",
				placement === "overlay" && "absolute -end-1 -top-1",
				resolveStatusToneIndicatorClassName(tone ?? "muted", "solid"),
				tone === "warning" && "dark:text-amber-950"
			)}
		>
			{formattedCount}
		</span>
	);
}
