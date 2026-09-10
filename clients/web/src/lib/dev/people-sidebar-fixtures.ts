import type {
	OrganizationComputerLocalAgentDetails,
	OrganizationComputersResponse,
} from "@openmeld/schemas/types";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import { readCurrentOrganizationProfileDirectory } from "#/lib/organizations/organization-directory";
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
	const members = input.members.map((member) => {
		const fixture = fixtures.get(member.id);
		if (!fixture || member.isCurrentUser) {
			return member;
		}
		const fixtureIndex = manifest.people.findIndex(
			(person) => person.profileId === member.id
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
	return { ...input, members };
}

/** Shared localhost Computer evidence, so previews and detail routes agree. */
export async function withPeopleComputerFixtures(
	response: OrganizationComputersResponse
): Promise<OrganizationComputersResponse> {
	const manifest = currentFixtureManifest();
	if (
		!(import.meta.env.DEV && isLocalFixtureHost()) ||
		response.organizationId !== manifest.organizationId
	) {
		return response;
	}
	const directory = await readCurrentOrganizationProfileDirectory({
		organizationId: response.organizationId,
	});
	const fixtures = new Map(
		directory.members.flatMap((member) => {
			const index = manifest.people.findIndex(
				(person) => person.profileId === member.humanProfile?.profileId
			);
			return index < 0
				? []
				: [
						[
							member.userId,
							{ index, state: manifest.people[index].state },
						] as const,
					];
		})
	);
	return {
		...response,
		computers: response.computers.flatMap(
			(computer): OrganizationComputersResponse["computers"] => {
				const fixture = fixtures.get(computer.ownerUserId);
				if (!fixture) {
					return [computer];
				}
				if (fixture.state === "unconnected") {
					return [];
				}
				if (
					fixture.state !== "connected" &&
					fixture.state !== "offline" &&
					fixture.state !== "needs_attention" &&
					fixture.state !== "unknown"
				) {
					return [computer];
				}
				return [
					{
						...computer,
						serviceState:
							fixture.state === "offline"
								? ("not_connected" as const)
								: fixture.state,
						localAgents: [
							"claude-code",
							"codex",
							"cursor",
							"opencode",
							"grok-build",
						]
							.slice(0, fixture.index % 3 === 0 ? 5 : (fixture.index % 3) + 1)
							.map((agentId) => ({
								agentControllerRef: `builtin:${agentId}`,
								enabled: true,
								details: previewUsageDetails(agentId, fixture.state),
								status:
									fixture.state === "connected"
										? ("ready" as const)
										: ("stale" as const),
							})),
					},
				];
			}
		),
	};
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
						{
							...limit,
							key: "spark-weekly",
							label: "Spark weekly usage",
							usedPercent: 24,
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
