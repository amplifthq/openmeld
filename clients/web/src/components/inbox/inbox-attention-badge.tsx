import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";

export function InboxAttentionBadge({
	count,
	tone,
	indicatorTone,
}: {
	count: number | null;
	tone: "danger" | "warning" | null;
	indicatorTone?: "danger" | "warning" | "unread" | null;
}) {
	if (indicatorTone === "unread") {
		return (
			<span
				aria-hidden="true"
				className="status-dot pointer-events-none absolute end-0 top-0 bg-unread"
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
				"pointer-events-none absolute end-0 top-0 h-3 min-w-3 rounded-full px-0.5 text-center font-semibold text-[8px] text-white tabular-nums leading-3",
				resolveStatusToneIndicatorClassName(tone ?? "muted", "solid"),
				tone === "warning" && "dark:text-amber-950"
			)}
		>
			{formattedCount}
		</span>
	);
}
