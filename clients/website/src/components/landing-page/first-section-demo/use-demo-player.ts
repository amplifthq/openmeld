import { useEffect, useRef, useState } from "react";

import type {
	BeatId,
	DemoPlayerStatus,
	DemoScript,
	VisibleBeatMap,
} from "./demo-types";

function createVisibleBeatMap(
	visibleBeatIds: readonly BeatId[]
): VisibleBeatMap {
	const visibleBeatMap: VisibleBeatMap = {};

	for (const beatId of visibleBeatIds) {
		visibleBeatMap[beatId] = true;
	}

	return visibleBeatMap;
}

export function useDemoPlayer(script: DemoScript) {
	const startTriggerRef = useRef<HTMLButtonElement | null>(null);
	const [status, setStatus] = useState<DemoPlayerStatus>("idle");
	const [visibleBeatIds, setVisibleBeatIds] = useState<BeatId[]>([]);

	useEffect(() => {
		if (status !== "playing") {
			return;
		}

		const timeouts = script.beats.map((beat) =>
			window.setTimeout(() => {
				setVisibleBeatIds((currentVisibleBeatIds) => {
					if (currentVisibleBeatIds.includes(beat.id)) {
						return currentVisibleBeatIds;
					}

					return [...currentVisibleBeatIds, beat.id];
				});
			}, beat.atMs)
		);

		const completionTimeout = window.setTimeout(() => {
			setStatus("completed");
		}, script.totalDurationMs);

		return () => {
			for (const timeout of timeouts) {
				window.clearTimeout(timeout);
			}

			window.clearTimeout(completionTimeout);
		};
	}, [script, status]);

	function start() {
		setStatus((currentStatus) => {
			if (currentStatus === "idle") {
				return "playing";
			}

			return currentStatus;
		});
	}

	return {
		isCompleted: status === "completed",
		isStarted: status !== "idle",
		startTriggerRef,
		start,
		status,
		visibleBeatCount: visibleBeatIds.length,
		visibleBeatMap: createVisibleBeatMap(visibleBeatIds),
	};
}
