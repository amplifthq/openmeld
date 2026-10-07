import { useEffect, useState } from "react";

/** Keep fast reads visually quiet; expose a pending affordance only if it lasts. */
export function useDelayedPending(pending: boolean, delayMs = 300): boolean {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (!pending) {
			setVisible(false);
			return;
		}
		const timer = window.setTimeout(() => setVisible(true), delayMs);
		return () => window.clearTimeout(timer);
	}, [delayMs, pending]);
	return pending && visible;
}
