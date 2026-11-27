import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type { AgentControllerUsageLimits } from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { SettingsLocalAgentUsageCompactReadout } from "@openmeld/ui/components/settings-computers";
import { Link } from "@tanstack/react-router";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import { ColleagueAgentChatButton } from "#/components/member-agents/colleague-agent-page-sidebar";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import type {
	DirectoryAgentProfileSummary,
	DirectoryHumanProfileRow,
} from "./directory-human-profile-model";

type AgentSource = {
	id: string;
	device: string;
	state: "Connected" | "Offline" | "Unavailable" | "Unknown";
	limits: AgentControllerUsageLimits;
};

type LocalAgent = {
	id: string;
	profiles: DirectoryAgentProfileSummary[];
	sources: AgentSource[];
};

export function resolveMemberLocalAgents(
	group: OrganizationComputerGroup | null,
	profiles: readonly DirectoryAgentProfileSummary[]
): LocalAgent[] {
	const agents = new Map<string, LocalAgent>();
	const getAgent = (id: string) => {
		const agent = agents.get(id) ?? { id, profiles: [], sources: [] };
		agents.set(id, agent);
		return agent;
	};
	for (const computer of group?.computers ?? []) {
		for (const { agentId, source } of resolveComputerSources(computer)) {
			getAgent(agentId).sources.push(source);
		}
	}
	for (const profile of profiles) {
		const controller = profile.agentControllerRef
			? parseAgentControllerRef(profile.agentControllerRef)
			: null;
		if (controller?.kind === "builtin") {
			getAgent(controller.id).profiles.push(profile);
		}
	}
	return [...agents.values()].sort(
		(left, right) =>
			Number(right.profiles.length > 0) - Number(left.profiles.length > 0) ||
			left.id.localeCompare(right.id)
	);
}

type Computer = OrganizationComputerGroup["computers"][number];
type ComputerSource = { agentId: string; source: AgentSource };

function resolveComputerSources(computer: Computer): ComputerSource[] {
	if (computer.ownedComputer) {
		return computer.ownedComputer.executionTargets.flatMap((target) =>
			resolveOwnerSources(computer, target)
		);
	}
	return computer.localAgents.flatMap((entry) => {
		const controller = parseAgentControllerRef(entry.agentControllerRef);
		return entry.enabled && controller?.kind === "builtin"
			? [
					{
						agentId: controller.id,
						source: {
							id: computer.routeId,
							device: computer.deviceDisplayName,
							state: resolveSourceState(computer.serviceState, entry.status),
							limits: entry.details?.usageLimits ?? [],
						},
					},
				]
			: [];
	});
}

function resolveOwnerSources(
	computer: Computer,
	target: NonNullable<Computer["ownedComputer"]>["executionTargets"][number]
): ComputerSource[] {
	return target.localAgentCatalog.entries.flatMap((entry) => {
		if (
			!(entry.enabled && entry.detected) ||
			entry.lifecycleStatus === "suspended"
		) {
			return [];
		}
		const capability = target.capabilities.find(
			(item) => item.agentControllerRef === `builtin:${entry.agentId}`
		);
		const status = entry.launchStatus === "ready" ? "ready" : "not_ready";
		return [
			{
				agentId: entry.agentId,
				source: {
					id: `${computer.routeId}:${target.runtimeLane}`,
					device: computer.deviceDisplayName,
					state: resolveSourceState(
						computer.serviceState,
						target.status === "stale" ? "stale" : status
					),
					limits: capability?.agentControllerInterface?.usageLimits ?? [],
				},
			},
		];
	});
}

function resolveSourceState(
	connection: OrganizationComputerGroup["computers"][number]["serviceState"],
	agent: "ready" | "not_ready" | "stale" | "unknown"
): AgentSource["state"] {
	if (connection === "not_connected") {
		return "Offline";
	}
	if (
		connection === "needs_attention" ||
		agent === "not_ready" ||
		agent === "stale"
	) {
		return "Unavailable";
	}
	return connection === "connected" && agent === "ready"
		? "Connected"
		: "Unknown";
}

export function MemberLocalAgents(input: {
	member: DirectoryHumanProfileRow;
	group: OrganizationComputerGroup | null;
	pending: boolean;
	failed: boolean;
	chatPending: boolean;
	nowMs?: number;
	onOpenAgent: (profileId: string) => void;
	onOpenHuman: () => void;
}) {
	const { member } = input;
	const agents = resolveMemberLocalAgents(input.group, member.agentProfiles);
	const managePath = member.isCurrentUser
		? member.agentProfilesPath
		: undefined;
	if (agents.length === 0 && !(input.pending || input.failed || managePath)) {
		return null;
	}
	return (
		<section
			aria-labelledby="member-local-agents"
			className="min-w-0 space-y-2"
		>
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-medium text-sm" id="member-local-agents">
					Local Agents
				</h2>
				{managePath ? (
					<Link
						className={buttonVariants({ size: "sm", variant: "ghost" })}
						to={managePath}
					>
						Manage
					</Link>
				) : null}
			</div>
			{input.failed ? (
				<p className="text-muted-foreground text-sm" role="alert">
					Connection unavailable
				</p>
			) : null}
			{input.pending && !input.failed ? (
				<output className="text-muted-foreground text-sm">
					Checking connection…
				</output>
			) : null}
			{agents.length > 0 ? (
				<ul className="divide-y divide-border rounded-lg border border-border">
					{agents.map((agent) => {
						const name = formatLocalAgentDisplayName(agent.id);
						return (
							<li
								className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 px-4 py-3"
								key={agent.id}
							>
								<div className="flex min-w-0 items-start gap-3">
									<LocalAgentLogo
										agentId={agent.id}
										className="mt-0.5 size-6 shrink-0"
									/>
									<div className="min-w-0 space-y-1">
										<h3 className="font-medium text-sm">{name}</h3>
										{agent.sources.map((source) => (
											<LocalAgentQuota
												agentName={name}
												key={source.id}
												nowMs={input.nowMs ?? Date.now()}
												showDevice={agent.sources.length > 1}
												source={source}
											/>
										))}
									</div>
								</div>
								{member.profileStatus === "active" ? (
									<div className="flex flex-wrap gap-2">
										{agent.profiles.map((profile) =>
											member.isCurrentUser ? (
												<Button
													disabled={input.chatPending}
													key={profile.id}
													onClick={() => input.onOpenAgent(profile.id)}
													size="sm"
													type="button"
												>
													Chat with {profile.name}
												</Button>
											) : (
												<ColleagueAgentChatButton
													key={profile.id}
													ownerUserId={member.userId}
													profileId={profile.id}
													profileName={profile.name}
												/>
											)
										)}
										{!member.isCurrentUser && agent.profiles.length === 0 ? (
											<Button
												aria-label={`Message ${member.name} about sharing ${name}`}
												disabled={input.chatPending}
												onClick={input.onOpenHuman}
												size="sm"
												type="button"
												variant="outline"
											>
												Message owner
											</Button>
										) : null}
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			) : null}
		</section>
	);
}

function LocalAgentQuota(input: {
	agentName: string;
	source: AgentSource;
	nowMs: number;
	showDevice: boolean;
}) {
	const { source } = input;
	const limits = source.limits
		.filter(
			(limit) =>
				limit.usedPercent !== null &&
				limit.status !== "unsupported" &&
				limit.status !== "unavailable"
		)
		.map((limit) => ({
			...limit,
			status:
				source.state === "Connected" &&
				(!limit.resetsAt || Date.parse(limit.resetsAt) > input.nowMs)
					? limit.status
					: ("stale" as const),
		}));
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span className="text-muted-foreground text-xs">
				{input.showDevice ? `${source.device} · ` : ""}
				{source.state}
			</span>
			{limits.length > 0 ? (
				<SettingsLocalAgentUsageCompactReadout
					agentName={input.agentName}
					limits={limits}
				/>
			) : (
				<span className="text-muted-foreground text-xs">Quota unavailable</span>
			)}
		</div>
	);
}
