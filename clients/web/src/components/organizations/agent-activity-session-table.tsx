import type {
	AgentActivityPublicSession,
	Project,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import type { StatusTone } from "@openmeld/ui/lib/status-tone";
import { resolveStatusToneBadgeClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { Fragment, type ReactNode } from "react";
import {
	formatDuration,
	formatProvider,
	formatRelativeTime,
	formatSessionName,
	isSessionCurrentlyActive,
	resolveSessionDurationMs,
} from "./agent-activity-derive";
import { AgentActivityMemberAvatar } from "./agent-activity-member-avatar";

export function AgentActivitySessionTable(input: {
	emptyMessage: ReactNode;
	membersByUserId: ReadonlyMap<string, { image: string | null; name: string }>;
	mode: "all" | "recent";
	nowMs: number;
	projects: Project[];
	sessions: AgentActivityPublicSession[];
}) {
	const projectsById = new Map(
		input.projects.map((project) => [project.id, project] as const)
	);
	const sessions = [...input.sessions].sort(
		(left, right) => right.lastObservedAtMs - left.lastObservedAtMs
	);
	const columnCount = input.mode === "recent" ? 5 : 8;
	return (
		<Table className="min-w-[720px]">
			<TableHeader>
				<TableRow className="hover:bg-transparent">
					<TableHead>Member</TableHead>
					<TableHead>Session</TableHead>
					<TableHead>Provider</TableHead>
					{input.mode === "all" ? (
						<>
							<TableHead>Project</TableHead>
							<TableHead>Branch</TableHead>
							<TableHead>Model</TableHead>
						</>
					) : null}
					<TableHead>Duration</TableHead>
					<TableHead>Status</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{sessions.length > 0 ? (
					sessions.map((session, index) => {
						const member = input.membersByUserId.get(session.memberUserId) ?? {
							image: null,
							name: session.memberName,
						};
						const metadata = resolveProviderMetadata(session, input.nowMs);
						return (
							<Fragment key={session.id}>
								<TableRow index={index}>
									<TableCell>
										<div className="flex items-center gap-2">
											<AgentActivityMemberAvatar
												active={isSessionCurrentlyActive(session, input.nowMs)}
												member={member}
												size="sm"
											/>
											<span className="font-medium">{member.name}</span>
										</div>
									</TableCell>
									<TableCell className="max-w-64 truncate font-medium">
										{formatSessionName(session)}
									</TableCell>
									<TableCell>{formatProvider(session)}</TableCell>
									{input.mode === "all" ? (
										<>
											<TableCell>
												{projectsById.get(session.projectId)?.name ??
													"Unknown Project"}
											</TableCell>
											<TableCell className="max-w-40 truncate font-mono text-muted-foreground">
												{session.gitBranch ?? "—"}
											</TableCell>
											<TableCell className="max-w-40 truncate font-mono text-muted-foreground">
												{session.model ?? "—"}
											</TableCell>
										</>
									) : null}
									<TableCell className="font-mono tabular-nums">
										{formatDuration(
											resolveSessionDurationMs(session, input.nowMs)
										)}
									</TableCell>
									<TableCell>
										<SessionStatusBadge nowMs={input.nowMs} session={session} />
									</TableCell>
								</TableRow>
								{metadata.length > 0 ? (
									<TableRow className="bg-muted/20 hover:bg-muted/20">
										<TableCell
											className="whitespace-normal py-1.5 font-mono text-[11px] text-muted-foreground"
											colSpan={columnCount}
										>
											{metadata.join(" · ")}
										</TableCell>
									</TableRow>
								) : null}
							</Fragment>
						);
					})
				) : (
					<TableRow className="hover:bg-transparent">
						<TableCell
							className="h-24 text-center text-muted-foreground"
							colSpan={columnCount}
						>
							{input.emptyMessage}
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
}

function SessionStatusBadge(input: {
	nowMs: number;
	session: AgentActivityPublicSession;
}) {
	const active = isSessionCurrentlyActive(input.session, input.nowMs);
	const display = resolveSessionStatusDisplay(input.session, active);
	return (
		<Badge
			className={cn(
				"rounded-md font-mono",
				resolveStatusToneBadgeClassName(display.tone)
			)}
		>
			{display.label}
		</Badge>
	);
}

function resolveSessionStatusDisplay(
	session: AgentActivityPublicSession,
	active: boolean
): { label: string; tone: StatusTone } {
	if (active) {
		return { label: "Working", tone: "ready" };
	}
	if (session.status === "unknown") {
		return { label: "Offline", tone: "muted" };
	}
	const label = `${session.status.charAt(0).toUpperCase()}${session.status.slice(1)}`;
	if (session.status === "idle") {
		return { label, tone: "warning" };
	}
	return { label, tone: session.status === "error" ? "danger" : "muted" };
}

export function resolveProviderMetadata(
	session: AgentActivityPublicSession,
	nowMs: number
) {
	const details: string[] = [];
	addDetail(details, session.gitCommit, "commit ");
	if (session.startedAtMs !== null) {
		addDetail(
			details,
			`started ${formatRelativeTime(session.startedAtMs, nowMs)}`
		);
	}
	if (session.provider === "codex") {
		return addCodexMetadata(details, session);
	}
	if (session.provider === "claude-code") {
		return addClaudeCodeMetadata(details, session);
	}
	if (session.provider === "cursor") {
		return addCursorMetadata(details, session);
	}
	return addOpenCodeMetadata(details, session);
}

function addCodexMetadata(
	details: string[],
	session: Extract<AgentActivityPublicSession, { provider: "codex" }>
) {
	const metadata = session.providerMetadata;
	if (!metadata) {
		return details;
	}
	addDetail(details, metadata.cliVersion, "cli ");
	addDetail(
		details,
		metadata.contextWindow === undefined
			? undefined
			: `${formatCompactNumber(metadata.contextWindow)} ctx`
	);
	addDetail(details, metadata.sandboxMode, "sandbox: ");
	addDetail(details, metadata.reasoningEffort, "reasoning: ");
	addDetail(details, metadata.approvalPolicy, "approval: ");
	addDetail(details, metadata.modelProvider, "provider: ");
	addDetail(details, metadata.originator, "origin: ");
	addDetail(details, metadata.source, "source: ");
	return details;
}

function addClaudeCodeMetadata(
	details: string[],
	session: Extract<AgentActivityPublicSession, { provider: "claude-code" }>
) {
	const metadata = session.providerMetadata;
	if (!metadata) {
		return details;
	}
	addDetail(details, metadata.entrypoint, "entry: ");
	addDetail(details, metadata.source, "source: ");
	addDetail(details, metadata.version, "version: ");
	addDetail(details, metadata.permissionMode, "permission: ");
	if (metadata.isSidechain !== undefined) {
		addDetail(details, metadata.isSidechain ? "sidechain" : "not sidechain");
	}
	return details;
}

function addCursorMetadata(
	details: string[],
	session: Extract<AgentActivityPublicSession, { provider: "cursor" }>
) {
	const metadata = session.providerMetadata;
	if (!metadata) {
		return details;
	}
	addDetail(details, metadata.composerMode, "mode: ");
	addDetail(details, metadata.source, "source: ");
	addDetail(details, metadata.version, "version: ");
	if (metadata.isBackgroundAgent !== undefined) {
		addDetail(
			details,
			metadata.isBackgroundAgent ? "background agent" : "foreground agent"
		);
	}
	return details;
}

function addOpenCodeMetadata(
	details: string[],
	session: Extract<AgentActivityPublicSession, { provider: "opencode" }>
) {
	const metadata = session.providerMetadata;
	if (!metadata) {
		return details;
	}
	addDetail(details, metadata.agent, "agent: ");
	addDetail(details, metadata.version, "version: ");
	addDetail(details, metadata.modelProvider, "provider: ");
	addDetail(details, metadata.modelVariant, "variant: ");
	addDetail(
		details,
		metadata.cost === undefined ? undefined : `$${String(metadata.cost)}`,
		"cost: "
	);
	addNumberDetail(details, metadata.tokensInput, "input");
	addNumberDetail(details, metadata.tokensOutput, "output");
	addNumberDetail(details, metadata.tokensReasoning, "reasoning");
	addNumberDetail(details, metadata.tokensCacheRead, "cache read");
	addNumberDetail(details, metadata.tokensCacheWrite, "cache write");
	return details;
}

function addDetail(
	details: string[],
	value: null | number | string | undefined,
	prefix = ""
) {
	if (value === null || value === undefined || value === "") {
		return;
	}
	details.push(`${prefix}${String(value)}`);
}

function addNumberDetail(
	details: string[],
	value: number | undefined,
	label: string
) {
	if (value !== undefined) {
		details.push(`${formatCompactNumber(value)} ${label}`);
	}
}

function formatCompactNumber(value: number) {
	if (value >= 1_000_000) {
		return `${String(Math.round(value / 100_000) / 10)}m`;
	}
	if (value >= 1000) {
		return `${String(Math.round(value / 100) / 10)}k`;
	}
	return String(value);
}
