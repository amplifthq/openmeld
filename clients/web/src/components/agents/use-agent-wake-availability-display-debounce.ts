import type { AgentWakeAvailability } from "@openmeld/schemas/types";
import { useEffect, useReducer, useRef } from "react";
import { SPACE_WAKE_DISPLAY_DEBOUNCE_MS } from "#/strategy-constants";

export type AgentWakeAvailabilityDisplayInput = {
	agentWakeAvailability?: AgentWakeAvailability | null;
	profileId: string;
};

export type AgentWakeAvailabilityDisplayOverrideByProfileId = ReadonlyMap<
	string,
	AgentWakeAvailability
>;

type ProfileDebounceState = {
	degradeStartedAtMs: number | null;
	lastAvailableSnapshot: AgentWakeAvailability | null;
};

/**
 * Keeps a recent Available badge visually stable across a brief connection
 * check. This state never replaces Core readiness and must not drive actions.
 */
export function reconcileWakeDisplayDebounce(input: {
	agents: readonly AgentWakeAvailabilityDisplayInput[];
	debounceMs: number;
	nowMs: number;
	previous: ReadonlyMap<string, ProfileDebounceState>;
}): {
	nextState: Map<string, ProfileDebounceState>;
	nextWakeAtMs: number | null;
	overrideByProfileId: Map<string, AgentWakeAvailability>;
} {
	const nextState = new Map<string, ProfileDebounceState>();
	const overrideByProfileId = new Map<string, AgentWakeAvailability>();
	let nextWakeAtMs: number | null = null;

	for (const agent of input.agents) {
		const previous = input.previous.get(agent.profileId);
		const availability = agent.agentWakeAvailability ?? null;
		const status = availability?.status ?? null;

		if (status === "available_for_wake" && availability) {
			nextState.set(agent.profileId, {
				degradeStartedAtMs: null,
				lastAvailableSnapshot: availability,
			});
			continue;
		}

		if (status === "checking_connection") {
			const lastAvailableSnapshot = previous?.lastAvailableSnapshot ?? null;
			if (!lastAvailableSnapshot) {
				nextState.set(agent.profileId, {
					degradeStartedAtMs: null,
					lastAvailableSnapshot: null,
				});
				continue;
			}

			const degradeStartedAtMs = previous?.degradeStartedAtMs ?? input.nowMs;
			if (input.nowMs - degradeStartedAtMs < input.debounceMs) {
				overrideByProfileId.set(agent.profileId, lastAvailableSnapshot);
				const wakeAtMs = degradeStartedAtMs + input.debounceMs;
				nextWakeAtMs =
					nextWakeAtMs === null ? wakeAtMs : Math.min(nextWakeAtMs, wakeAtMs);
			}
			nextState.set(agent.profileId, {
				degradeStartedAtMs,
				lastAvailableSnapshot,
			});
			continue;
		}

		nextState.set(agent.profileId, {
			degradeStartedAtMs: null,
			lastAvailableSnapshot: null,
		});
	}

	return { nextState, nextWakeAtMs, overrideByProfileId };
}

export function useAgentWakeAvailabilityDisplayDebounce(
	agents: readonly AgentWakeAvailabilityDisplayInput[]
): AgentWakeAvailabilityDisplayOverrideByProfileId {
	const stateRef = useRef<Map<string, ProfileDebounceState>>(new Map());
	const [, forceTick] = useReducer((tick: number) => tick + 1, 0);
	const { nextState, nextWakeAtMs, overrideByProfileId } =
		reconcileWakeDisplayDebounce({
			agents,
			debounceMs: SPACE_WAKE_DISPLAY_DEBOUNCE_MS,
			nowMs: Date.now(),
			previous: stateRef.current,
		});
	stateRef.current = nextState;

	useEffect(() => {
		if (nextWakeAtMs === null) {
			return;
		}
		const timer = window.setTimeout(
			forceTick,
			Math.max(0, nextWakeAtMs - Date.now())
		);
		return () => {
			window.clearTimeout(timer);
		};
	}, [nextWakeAtMs]);

	return overrideByProfileId;
}
