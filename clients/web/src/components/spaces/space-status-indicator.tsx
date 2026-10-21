import { cn } from "@openmeld/ui/lib/utils";
import { resolveInboxIndicatorClassName } from "#/lib/inbox/attention";
import { SpaceActiveWakeIndicator } from "./space-active-wake-indicator";
import { resolveSpaceActiveWakePresentation } from "./space-active-wake-presentation";
import {
	hasSpaceStatus,
	type SpaceStatusIndicators,
} from "./space-status-indicators";

/**
 * The sidebar row's status marks (attention dot, active work orb, unread dot)
 * for places that are already one link or menu item, such as Session rows and
 * the chat title. Decorative: the owner puts the words in its accessible name
 * with resolveSpaceStatusLabel.
 */
export function SpaceStatusIndicator(input: {
	indicators: SpaceStatusIndicators;
	className?: string;
}) {
	const { indicators } = input;
	if (!hasSpaceStatus(indicators)) {
		return null;
	}
	const presentation = indicators.activeWakeSummary
		? resolveSpaceActiveWakePresentation(indicators.activeWakeSummary)
		: null;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5",
				input.className
			)}
			data-space-status-indicator="true"
		>
			{indicators.attentionTone || !presentation ? (
				<span
					className={`status-dot shrink-0 ${resolveInboxIndicatorClassName(indicators.attentionTone)}`}
					data-space-status={indicators.attentionTone ? "attention" : "unread"}
				/>
			) : null}
			{presentation ? (
				<span className="inline-flex" data-space-status="active">
					<SpaceActiveWakeIndicator presentation={presentation} />
				</span>
			) : null}
		</span>
	);
}
