import { useSyncExternalStore } from "react";
import { currentFixtureManifest, isLocalFixtureHost } from "./fixture-manifest";

const subscribe = () => () => {
	/* The hydrated snapshot never changes. */
};
export function useAgentSidebarPreviewReady() {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false
	);
}

/** Display-only fixtures; never grant readiness or alter a Wake request. */
export function localAgentSidebarState(
	profileId: string,
	enabled = false
): "available" | "checking" | "offline" | "connect" | "unavailable" | null {
	const manifest = currentFixtureManifest();
	if (
		!(enabled && import.meta.env.DEV) ||
		typeof window === "undefined" ||
		!isLocalFixtureHost() ||
		!window.location.pathname.startsWith(`/o/${manifest.organizationSlug}/`)
	) {
		return null;
	}
	const fixtures = manifest as typeof manifest & {
		agents?: { profileId: string; state: string }[];
	};
	const state = fixtures.agents?.find(
		(agent) => agent.profileId === profileId
	)?.state;
	return state === "available" ||
		state === "checking" ||
		state === "offline" ||
		state === "connect" ||
		state === "unavailable"
		? state
		: null;
}
