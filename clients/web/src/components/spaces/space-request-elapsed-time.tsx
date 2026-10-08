import { useNowMs } from "#/lib/spaces/use-now-ms";

/** Time since the user's request, including delivery and model preparation. */
export function SpaceRequestElapsedTime({
	startedAtMs,
}: {
	startedAtMs: number;
}) {
	const nowMs = useNowMs(1000);
	return (
		<span className="shrink-0 tabular-nums">
			{formatElapsedDuration(
				Math.max(0, Math.floor((nowMs - startedAtMs) / 1000))
			)}
		</span>
	);
}

export function formatElapsedDuration(totalSeconds: number): string {
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes < 60) {
		return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
	}
	return `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}
