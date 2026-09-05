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
		const refresh = () => setNowMs(Date.now());
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.clearInterval(intervalId);
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [intervalMs]);

	return nowMs;
}
