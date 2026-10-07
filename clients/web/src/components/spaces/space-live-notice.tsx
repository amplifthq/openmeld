import { Button } from "@openmeld/ui/components/button";
import { useEffect, useState } from "react";
import type { SpaceLiveState } from "#/lib/spaces/timeline";

// Presentation-only grace period. Transport recovery continues independently.
const NOTICE_DELAY_MS = 15_000;

export function SpaceLiveNotice(input: {
	hidden?: boolean;
	liveState: SpaceLiveState;
	onRetry: () => void;
}) {
	const interrupted =
		input.liveState === "degraded" || input.liveState === "stale";
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (!interrupted) {
			setVisible(false);
			return;
		}
		const timer = setTimeout(() => setVisible(true), NOTICE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [interrupted]);

	return (
		<div aria-atomic="true" aria-live="polite">
			{interrupted && visible && !input.hidden ? (
				<div className="flex items-center justify-between gap-3 border-border border-b px-4 py-1.5 text-muted-foreground text-xs sm:px-5">
					<span>Messages and activity may be out of date.</span>
					<Button onClick={input.onRetry} size="sm" variant="ghost">
						Retry
					</Button>
				</div>
			) : null}
		</div>
	);
}
