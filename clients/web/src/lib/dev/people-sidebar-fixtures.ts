import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import manifest from "../../../scripts/sidebar-preview/runtime-states.local.json";

/** Presentation fixtures for the seeded localhost account only; no Service or readiness writes. */
export function localPeopleSidebarFixtures(input: {
	members: readonly DirectoryHumanProfileRow[];
	computerGroups: readonly OrganizationComputerGroup[];
	orgSlug: string;
	enabled: boolean;
}) {
	if (
		!(import.meta.env.DEV && input.enabled) ||
		typeof window === "undefined" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) ||
		input.orgSlug !== manifest.organizationSlug ||
		!input.members.some((m) => m.isCurrentUser && m.id === manifest.profileId)
	) {
		return input;
	}
	const fixtures = new Map(manifest.people.map((p) => [p.profileId, p.state]));
	const ownerStates = new Map<string, string>();
	const members = input.members.map((member) => {
		const fixture = fixtures.get(member.id);
		if (!fixture || member.isCurrentUser) {
			return member;
		}
		ownerStates.set(member.userId, fixture);
		const state =
			fixture === "connected" ||
			fixture === "needs_attention" ||
			fixture === "unknown"
				? fixture
				: "not_connected";
		const labels = {
			connected: "Computer connected",
			offline: "Computer offline",
			unconnected: "No computer connected",
			needs_attention: "Computer needs attention",
			unknown: "Computer status unavailable",
		};
		return {
			...member,
			notice: "Local preview: computer connection states are simulated.",
			computer: {
				...member.computer,
				state,
				count: fixture === "unconnected" ? 0 : member.computer.count,
				label: labels[fixture as keyof typeof labels],
			},
		} satisfies DirectoryHumanProfileRow;
	});
	const computerGroups: readonly OrganizationComputerGroup[] =
		input.computerGroups.map((group): OrganizationComputerGroup => {
			const fixture = ownerStates.get(group.ownerUserId);
			if (!fixture) {
				return group;
			}
			if (fixture === "unconnected") {
				return { ...group, computers: [] };
			}
			const serviceState =
				fixture === "offline"
					? "not_connected"
					: (fixture as "connected" | "needs_attention" | "unknown");
			return {
				...group,
				computers: group.computers.map((computer) => ({
					...computer,
					serviceState,
				})),
			};
		});
	return { ...input, members, computerGroups };
}
