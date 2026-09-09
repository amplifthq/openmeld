import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";

export function InboxAttentionBadge({
	count,
	tone,
}: {
	count: number | null;
	tone: "danger" | "warning" | null;
}) {
	if (count === null || count === 0) {
		return null;
	}
	const formattedCount = count > 99 ? "99+" : count;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute -end-1 -top-0.5 h-3.5 min-w-3.5 rounded-full px-0.5 text-center font-semibold text-[9px] text-white tabular-nums leading-3.5",
				resolveStatusToneIndicatorClassName(tone ?? "muted", "solid"),
				tone === "warning" && "dark:text-amber-950"
			)}
		>
			{formattedCount}
		</span>
	);
}
