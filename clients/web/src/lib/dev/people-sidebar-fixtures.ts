import type { OrganizationComputerLocalAgentDetails } from "@openmeld/schemas/types";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import { currentFixtureManifest, isLocalFixtureHost } from "./fixture-manifest";

/** Presentation fixtures for the seeded localhost account only; no Service or readiness writes. */
export function localPeopleSidebarFixtures(input: {
	members: readonly DirectoryHumanProfileRow[];
	computerGroups: readonly OrganizationComputerGroup[];
	orgSlug: string;
	enabled: boolean;
}) {
	const manifest = currentFixtureManifest();
	if (
		!(import.meta.env.DEV && input.enabled) ||
		typeof window === "undefined" ||
		!isLocalFixtureHost() ||
		input.orgSlug !== manifest.organizationSlug ||
		!input.members.some((m) => m.isCurrentUser && m.id === manifest.profileId)
	) {
		return input;
	}
	const fixtures = new Map(manifest.people.map((p) => [p.profileId, p.state]));
	const ownerStates = new Map<string, string>();
	const ownerLocalAgents = new Map<string, string[]>();
	const members = input.members.map((member) => {
		const fixture = fixtures.get(member.id);
		if (!fixture || member.isCurrentUser) {
			return member;
		}
		ownerStates.set(member.userId, fixture);
		const fixtureIndex = manifest.people.findIndex(
			(person) => person.profileId === member.id
		);
		ownerLocalAgents.set(
			member.userId,
			["claude-code", "codex", "cursor", "opencode", "grok-build"].slice(
				0,
				fixtureIndex % 3 === 0 ? 5 : (fixtureIndex % 3) + 1
			)
		);
		const state =
			fixture === "connected" ||
			fixture === "needs_attention" ||
			fixture === "unknown"
				? fixture
				: "not_connected";
		const labels = {
			connected: "Computer connected",
			offline: "Computer disconnected",
			unconnected: "No computer connected",
			needs_attention: "Computer needs attention",
			unknown: "Computer status unavailable",
		};
		return {
			...member,
			notice:
				"Local preview: computer status, local agents, usage limits, and Slack connections are simulated.",
			identityAccounts:
				fixtureIndex % 2 === 0
					? [
							...member.identityAccounts.filter(
								(account) => account.provider !== "slack"
							),
							{
								provider: "slack",
								providerLabel: "Slack",
								id: `local-preview-slack-${member.id}`,
								accountName: `${member.name} (preview)`,
								accountEmail: `${member.name.toLowerCase().replaceAll(" ", ".")}@example.invalid`,
								state: "connected",
								action: null,
								canDisconnect: false,
								channelsPath: null,
							},
						]
					: member.identityAccounts,
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
					localAgents: (ownerLocalAgents.get(group.ownerUserId) ?? []).map(
						(agentId) => ({
							agentControllerRef: `builtin:${agentId}`,
							enabled: true,
							details: previewUsageDetails(agentId, fixture),
							status:
								fixture === "connected"
									? ("ready" as const)
									: ("stale" as const),
						})
					),
				})),
			};
		});
	return { ...input, members, computerGroups };
}

function previewUsageDetails(
	agentId: string,
	state: string
): OrganizationComputerLocalAgentDetails | undefined {
	if (agentId !== "codex" && agentId !== "opencode") {
		return undefined;
	}
	const observedAt = new Date(Date.now() - 10 * 60_000).toISOString();
	const limit = {
		key: "weekly",
		label: "Weekly usage",
		observedAt,
		resetsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
		status: state === "connected" ? ("available" as const) : ("stale" as const),
		usedPercent: state === "needs_attention" ? 96 : 38,
	};
	return {
		capabilities: {
			approvals: true,
			cancel: true,
			interrupt: true,
			modelSelection: true,
			nativeEventStream: true,
			permissionModes: true,
			structuredUserInput: false,
		},
		checkedAt: observedAt,
		launch: { installChoiceCount: 1, status: "ready" },
		models: [],
		nativeInterface: "local-cli",
		status: "ready",
		version: null,
		usageLimits:
			agentId === "codex"
				? [
						limit,
						{
							...limit,
							key: "five-hour",
							label: "5-hour usage",
							usedPercent: 12,
						},
					]
				: [
						{
							...limit,
							provider: { id: "opencode-go", displayName: "OpenCode Go" },
							usedPercent: 86,
						},
						{
							...limit,
							key: "proxy",
							provider: { id: "company-proxy", displayName: "Company Proxy" },
							usedPercent: 25,
						},
					],
	};
}
