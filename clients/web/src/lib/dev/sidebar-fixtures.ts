import type { SpaceSidebarActiveWakeSummary } from "#/components/spaces/space-active-wake-presentation";
import manifest from "../../../scripts/sidebar-preview/runtime-states.local.json";

/** Local visual fixtures only; never report these as execution or readiness facts. */
export function localSidebarWakeFixtures(
	organizationId: string,
	profileId: string
): SpaceSidebarActiveWakeSummary[] {
	if (
		!import.meta.env.DEV ||
		typeof window === "undefined" ||
		!(
			["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) ||
			window.location.hostname.endsWith(".localhost")
		) ||
		manifest.organizationId !== organizationId ||
		manifest.profileId !== profileId
	) {
		return [];
	}
	return (
		manifest.spaces as {
			spaceId: string;
			profileId: string;
			profileName: string;
			needsInput: boolean;
		}[]
	).map((item) => ({
		spaceId: item.spaceId,
		activeWakeCount: 1,
		activeTargets: [
			{
				profileId: item.profileId,
				profileName: item.profileName,
				activeWakeCount: 1,
			},
		],
		statuses: [
			{
				kind: item.needsInput ? "needs_input" : "working",
				label: item.needsInput
					? `${item.profileName} needs your input`
					: `${item.profileName} is working`,
				description:
					"Local sidebar visual fixture; no Agent execution is running.",
				status: item.needsInput ? "pending" : "active",
			},
		],
	}));
}
