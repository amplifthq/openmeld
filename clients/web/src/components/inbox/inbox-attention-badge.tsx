import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";

export function InboxAttentionBadge({
	count,
	tone,
}: {
	count: number | null;
	tone: "danger" | "warning" | null;
}) {
	if (count === 0) {
		return null;
	}
	const formattedCount = count !== null && count > 99 ? "99+" : count;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute -end-1.5 -top-1 h-4 min-w-4 rounded-full px-1 text-center font-semibold text-[10px] text-white tabular-nums leading-4",
				resolveStatusToneIndicatorClassName(tone ?? "muted", "solid"),
				tone === "warning" && "dark:text-amber-950"
			)}
		>
			{formattedCount ?? "?"}
		</span>
	);
}
