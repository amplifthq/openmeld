import { useEffect, useState } from "react";

export function useNowMs(intervalMs: number | null): number {
	const [nowMs, setNowMs] = useState(() => Date.now());

	useEffect(() => {
		if (intervalMs === null) {
			return;
		}
		const intervalId = window.setInterval(() => {
			setNowMs(Date.now());
		}, intervalMs);
		return () => {
			window.clearInterval(intervalId);
		};
	}, [intervalMs]);

	return nowMs;
}
