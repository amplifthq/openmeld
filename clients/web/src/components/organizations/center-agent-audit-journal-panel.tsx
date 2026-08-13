"use client";

import type {
	ListCenterAgentAuditJournalResponse,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	BookOpenTextIcon,
	BuildingsIcon,
	ChatCircleTextIcon,
	CheckIcon,
	FolderOpenIcon,
	GearSixIcon,
	LinkIcon,
	PauseCircleIcon,
	PlayCircleIcon,
	PlusIcon,
	PulseIcon,
	RobotIcon,
	UserCheckIcon,
	XCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { resolveCenterAgentErrorMessage } from "#/lib/organizations/center-agent";
import { formatCenterAgentInteractionClient } from "#/lib/organizations/center-agent-interaction-source";
import { centerAgentAuditJournalQueryOptions } from "#/query/organizations/center-agent";
import type { DirectoryAgentProfile } from "./center-agent-profile-presentation";

type DirectoryMember = OrganizationDirectoryResponse["members"][number];
type CenterAgentAuditEntry =
	ListCenterAgentAuditJournalResponse["entries"][number];
const TITLE_CASE_WORD_SEPARATOR_PATTERN = /\s+/;
const UTC_AUDIT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeZone: "UTC",
});
const UTC_AUDIT_DAY_KEY_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "2-digit",
	month: "2-digit",
	timeZone: "UTC",
	year: "numeric",
});
const UTC_AUDIT_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	minute: "2-digit",
	timeZone: "UTC",
	timeZoneName: "short",
});
const BROWSER_AUDIT_TIME_ZONE =
	typeof window === "undefined"
		? "UTC"
		: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const BROWSER_AUDIT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeZone: BROWSER_AUDIT_TIME_ZONE,
});
const BROWSER_AUDIT_DAY_KEY_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "2-digit",
	month: "2-digit",
	timeZone: BROWSER_AUDIT_TIME_ZONE,
	year: "numeric",
});
const BROWSER_AUDIT_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	minute: "2-digit",
	timeZone: BROWSER_AUDIT_TIME_ZONE,
});
const CONTEXT_TOKEN_NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

const CENTER_AGENT_ACTION_PRESENTATION = {
	add_agent_profiles_to_space: {
		icon: PlusIcon,
		label: "Added agents to Space",
	},
	authorize_remote_center_agent_binding: {
		icon: LinkIcon,
		label: "Authorized hosted Center Agent",
	},
	carry_over_binding_authorization: {
		icon: LinkIcon,
		label: "Kept Center Agent access after the profile changed",
	},
	create_agent_profile: { icon: RobotIcon, label: "Created Agent Profile" },
	create_project: { icon: FolderOpenIcon, label: "Created Project" },
	create_routine: { icon: PlusIcon, label: "Created Routine" },
	create_org_document_folder: {
		icon: FolderOpenIcon,
		label: "Created document folder",
	},
	create_space: { icon: BuildingsIcon, label: "Created Space" },
	draft_org_document: {
		icon: BookOpenTextIcon,
		label: "Drafted organization document",
	},
	move_org_document: {
		icon: FolderOpenIcon,
		label: "Moved organization document",
	},
	designate_remote_center_agent: {
		icon: RobotIcon,
		label: "Connected Center Agent",
	},
	enable_agent_profile: { icon: CheckIcon, label: "Enabled Agent Profile" },
	invite_member: { icon: UserCheckIcon, label: "Invited Member" },
	post_space_message: {
		icon: ChatCircleTextIcon,
		label: "Posted Space message",
	},
	prepare_remove_project: {
		icon: XCircleIcon,
		label: "Prepared Project removal",
	},
	read_dispatch_history: {
		icon: BookOpenTextIcon,
		label: "Checked agent request history",
	},
	read_org_directory: {
		icon: BookOpenTextIcon,
		label: "Read organization directory",
	},
	read_member_openmeld_service_status: {
		icon: BookOpenTextIcon,
		label: "Checked member computer status",
	},
	read_slack_workspace_directory: {
		icon: BookOpenTextIcon,
		label: "Read Slack workspace directory",
	},
	read_org_documents: {
		icon: BookOpenTextIcon,
		label: "Read organization documents",
	},
	rename_org_document_folder: {
		icon: FolderOpenIcon,
		label: "Renamed document folder",
	},
	read_org_space_directory: {
		icon: BookOpenTextIcon,
		label: "Read Space directory",
	},
	read_projects: { icon: BookOpenTextIcon, label: "Read Projects" },
	read_space_context: { icon: BookOpenTextIcon, label: "Read Space context" },
	remove_agent_profiles_from_space: {
		icon: XCircleIcon,
		label: "Removed agents from Space",
	},
	remove_project: { icon: XCircleIcon, label: "Removed Project" },
	delete_routine: { icon: XCircleIcon, label: "Deleted Routine" },
	save_org_document: {
		icon: BookOpenTextIcon,
		label: "Saved organization document",
	},
	pause_center_agent: {
		icon: PauseCircleIcon,
		label: "Paused Center Agent",
	},
	pause_routine: { icon: PauseCircleIcon, label: "Paused Routine" },
	resume_center_agent: {
		icon: PlayCircleIcon,
		label: "Resumed Center Agent",
	},
	resume_routine: { icon: PlayCircleIcon, label: "Resumed Routine" },
	connect_slack_workspace: {
		icon: LinkIcon,
		label: "Connected Slack workspace",
	},
	move_slack_workspace: {
		icon: LinkIcon,
		label: "Moved Slack workspace to another organization",
	},
	disconnect_slack_workspace: {
		icon: XCircleIcon,
		label: "Disconnected Slack workspace",
	},
	disconnect_shared_app: {
		icon: XCircleIcon,
		label: "Disconnected shared App",
	},
	start_shared_app_authorization: {
		icon: LinkIcon,
		label: "Started shared App authorization",
	},
	set_agent_profile_default_project: {
		icon: FolderOpenIcon,
		label: "Set Agent Profile Default Project",
	},
	update_project: { icon: GearSixIcon, label: "Updated Project" },
	update_routine: { icon: GearSixIcon, label: "Updated Routine" },
	update_space_settings: { icon: GearSixIcon, label: "Updated Space settings" },
	wake_agent_profiles_in_space: {
		icon: PulseIcon,
		label: "Woke agents in Space",
	},
} as const;

export function CenterAgentAuditJournalPanel(input: {
	enabled: boolean;
	members: readonly DirectoryMember[];
	organizationId: string;
	profiles: readonly DirectoryAgentProfile[];
}) {
	const canShowBrowserTimeZone = useSyncExternalStore(
		subscribeToBrowserEnvironment,
		getBrowserEnvironmentSnapshot,
		getServerEnvironmentSnapshot
	);
	const auditQuery = useQuery(
		centerAgentAuditJournalQueryOptions({
			enabled: input.enabled,
			organizationId: input.organizationId,
		})
	);

	if (auditQuery.isPending) {
		return <CenterAgentInlineState label="Loading Center Agent audit log." />;
	}
	if (auditQuery.isError) {
		return (
			<CenterAgentErrorState
				message={resolveCenterAgentErrorMessage(auditQuery.error, "audit_list")}
				onRetry={() => {
					auditQuery.refetch().catch((error) => {
						console.error("Failed to refresh Center Agent audit log.", error);
					});
				}}
				title="Could not load Center Agent audit log."
			/>
		);
	}
	if (!auditQuery.data || auditQuery.data.entries.length === 0) {
		return (
			<section className="px-5 py-5">
				<p className="font-medium text-foreground text-sm">
					No Center Agent audit entries yet.
				</p>
				<p className="mt-1 text-muted-foreground text-sm">
					Center Agent actions and Local Agent requests will appear here.
				</p>
			</section>
		);
	}

	return (
		<div>
			{groupAuditEntriesByDay(
				auditQuery.data.entries,
				canShowBrowserTimeZone
			).map((group) => (
				<section
					className="border-border/70 border-b last:border-b-0"
					key={group.key}
				>
					<header className="border-border/70 border-b px-5 py-3">
						<h2 className="font-medium text-muted-foreground text-xs uppercase">
							{group.label}
						</h2>
					</header>
					<ul className="divide-y divide-border/70">
						{group.entries.map((entry) => (
							<CenterAgentAuditJournalItem
								canShowBrowserTimeZone={canShowBrowserTimeZone}
								entry={entry}
								key={entry.id}
								members={input.members}
								profiles={input.profiles}
							/>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

function CenterAgentAuditJournalItem(input: {
	canShowBrowserTimeZone: boolean;
	entry: CenterAgentAuditEntry;
	members: readonly DirectoryMember[];
	profiles: readonly DirectoryAgentProfile[];
}) {
	const presentation = resolveCenterAgentActionPresentation(input.entry);
	const Icon = presentation.icon;
	const actorName = resolveAuditActorName({
		actorProfileId: input.entry.actorProfileId,
		members: input.members,
	});
	const resourceName = resolveAuditResourceName({
		entry: input.entry,
		profiles: input.profiles,
	});
	const localAgentName = resolveAuditLocalAgentName(input.entry);
	const attribution = formatAuditAttribution(input.entry, localAgentName);
	const showTechnicalDetails = !isLocalAgentInteractionAction(
		input.entry.action
	);
	const showResourceDetails =
		showTechnicalDetails &&
		input.entry.resource?.type !== "center_agent_context_manifest" &&
		input.entry.resource?.type !== "center_agent_context_load_receipt";
	return (
		<li className="px-5 py-4">
			<div className="flex items-start gap-3">
				<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-muted/30 text-muted-foreground">
					<Icon aria-hidden="true" className="size-4" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
						<div className="min-w-0">
							<p className="font-medium text-foreground text-sm">
								{presentation.label}
							</p>
							<p className="mt-1 text-muted-foreground text-xs">
								{actorName}
								{attribution ? ` · ${attribution}` : ""}
								{resourceName ? ` · ${resourceName}` : ""}
							</p>
						</div>
						<time
							className="shrink-0 text-muted-foreground text-xs"
							dateTime={input.entry.createdAt}
						>
							{formatTime(input.entry.createdAt, input.canShowBrowserTimeZone)}
						</time>
					</div>
					<details className="mt-2 text-muted-foreground text-xs">
						<summary className="cursor-pointer">Details</summary>
						<dl className="mt-2 grid gap-1">
							{showTechnicalDetails ? (
								<>
									<div>
										<dt className="inline">Action: </dt>
										<dd className="inline">{input.entry.action}</dd>
									</div>
									<div>
										<dt className="inline">Actor profile ID: </dt>
										<dd className="inline break-all">
											{input.entry.actorProfileId}
										</dd>
									</div>
								</>
							) : null}
							{localAgentName ? (
								<div>
									<dt className="inline">Local Agent: </dt>
									<dd className="inline">{localAgentName}</dd>
								</div>
							) : null}
							{input.entry.resource && showResourceDetails ? (
								<div>
									<dt className="inline">Resource: </dt>
									<dd className="inline break-all">
										{input.entry.resource.type} / {input.entry.resource.id}
									</dd>
								</div>
							) : null}
							{input.entry.onBehalfOf ? (
								<div>
									<dt className="inline">Requested by: </dt>
									<dd className="inline break-all">
										{input.entry.onBehalfOf.displayName}
										{showTechnicalDetails
											? ` / ${input.entry.onBehalfOf.profileId}`
											: ""}
									</dd>
								</div>
							) : null}
							{input.entry.contextManifest ? (
								<>
									<div>
										<dt className="inline">Prepared context: </dt>
										<dd className="inline">
											{formatContextVolume({
												estimatedTokens:
													input.entry.contextManifest.estimatedTokens,
												includedMessages:
													input.entry.contextManifest.includedMessages,
											})}
										</dd>
									</div>
									{input.entry.contextManifest.truncated ? (
										<div>
											<dt className="sr-only">Context boundary: </dt>
											<dd>
												The request used a bounded context window, so older or
												larger content may not be included.
											</dd>
										</div>
									) : null}
								</>
							) : null}
							{input.entry.contextLoad ? (
								<>
									<div>
										<dt className="inline">Reported loaded: </dt>
										<dd className="inline">
											{formatContextVolume({
												estimatedTokens:
													input.entry.contextLoad.estimatedTokens,
												includedMessages:
													input.entry.contextLoad.includedMessages,
											})}
										</dd>
									</div>
									<div>
										<dt className="sr-only">Meaning: </dt>
										<dd>
											This confirms what the Local Agent reported adding to its
											working context. It does not mean the model used every
											message in its answer.
										</dd>
									</div>
								</>
							) : null}
						</dl>
					</details>
				</div>
			</div>
		</li>
	);
}

function CenterAgentErrorState(input: {
	message: string;
	onRetry: () => void;
	title: string;
}) {
	return (
		<div className="border-destructive border-l bg-destructive/10 px-5 py-4">
			<p className="font-medium text-destructive text-sm">{input.title}</p>
			<p className="mt-1 text-muted-foreground text-sm">{input.message}</p>
			<Button
				className="mt-4"
				onClick={input.onRetry}
				size="sm"
				type="button"
				variant="outline"
			>
				Retry
			</Button>
		</div>
	);
}

function CenterAgentInlineState(input: { label: string }) {
	return (
		<div className="px-5 py-4 text-muted-foreground text-sm">{input.label}</div>
	);
}

function resolveAuditActorName(input: {
	actorProfileId: string;
	members: readonly DirectoryMember[];
}): string {
	return (
		resolveMemberNameByProfileId(input.members, input.actorProfileId) ??
		"Center Agent"
	);
}

function resolveAuditResourceName(input: {
	entry: CenterAgentAuditEntry;
	profiles: readonly DirectoryAgentProfile[];
}): string | null {
	const resource = input.entry.resource;
	if (!resource) {
		return null;
	}
	if (resource.type === "agent_profile") {
		return (
			input.profiles.find((candidate) => candidate.profileId === resource.id)
				?.profileName ?? "Agent Profile"
		);
	}
	if (resource.type === "invitation_email") {
		return resource.id;
	}
	if (resource.type === "local_agent_client") {
		return null;
	}
	if (
		resource.type === "center_agent_context_manifest" ||
		resource.type === "center_agent_context_load_receipt"
	) {
		return null;
	}
	return titleCase(resource.type.replaceAll("_", " "));
}

function resolveMemberNameByProfileId(
	members: readonly DirectoryMember[],
	profileId: string
): string | null {
	const member = members.find(
		(candidate) => candidate.humanProfile?.profileId === profileId
	);
	return member?.humanProfile?.profileName ?? member?.user.name ?? null;
}

function resolveCenterAgentActionPresentation(entry: CenterAgentAuditEntry) {
	if (entry.action === "receive_local_agent_request") {
		const client =
			entry.resource?.type === "local_agent_client"
				? formatCenterAgentInteractionClient(entry.resource.id)
				: "Local Agent";
		return {
			icon: ChatCircleTextIcon,
			label: `Received request via ${client}`,
		};
	}
	if (entry.action === "read_center_agent_context") {
		const client = entry.interactionSource?.client
			? formatCenterAgentInteractionClient(entry.interactionSource.client)
			: "Local Agent";
		return {
			icon: ChatCircleTextIcon,
			label: entry.contextManifest
				? `Prepared ${formatMessageCount(entry.contextManifest.includedMessages)} for ${client}`
				: `Prepared Center Agent context for ${client}`,
		};
	}
	if (entry.action === "load_center_agent_context") {
		const client = entry.interactionSource?.client
			? formatCenterAgentInteractionClient(entry.interactionSource.client)
			: "Local Agent";
		return {
			icon: CheckIcon,
			label: entry.contextLoad
				? `${client} added ${formatMessageCount(entry.contextLoad.includedMessages)} to its working context`
				: `${client} added Center Agent context to its working context`,
		};
	}
	const action = entry.action;
	if (action in CENTER_AGENT_ACTION_PRESENTATION) {
		return CENTER_AGENT_ACTION_PRESENTATION[
			action as keyof typeof CENTER_AGENT_ACTION_PRESENTATION
		];
	}
	return { icon: PulseIcon, label: titleCase(action.replaceAll("_", " ")) };
}

function isLocalAgentInteractionAction(action: string): boolean {
	return (
		action === "receive_local_agent_request" ||
		action === "read_center_agent_context" ||
		action === "load_center_agent_context"
	);
}

function resolveAuditLocalAgentName(
	entry: CenterAgentAuditEntry
): string | null {
	const client =
		entry.interactionSource?.client ??
		(entry.resource?.type === "local_agent_client"
			? entry.resource.id
			: undefined);
	if (client) {
		return formatCenterAgentInteractionClient(client);
	}
	return isLocalAgentInteractionAction(entry.action) ? "Local Agent" : null;
}

function formatAuditAttribution(
	entry: CenterAgentAuditEntry,
	localAgentName: string | null
): string | null {
	if (!entry.onBehalfOf) {
		return null;
	}
	return localAgentName
		? `Requested by ${entry.onBehalfOf.displayName} via ${localAgentName}`
		: `Requested by ${entry.onBehalfOf.displayName}`;
}

function formatMessageCount(count: number): string {
	return `${count} Center Agent ${count === 1 ? "message" : "messages"}`;
}

function formatContextVolume(input: {
	estimatedTokens: number;
	includedMessages: number;
}): string {
	return `${formatMessageCount(input.includedMessages)} · about ${CONTEXT_TOKEN_NUMBER_FORMATTER.format(input.estimatedTokens)} ${input.estimatedTokens === 1 ? "token" : "tokens"}`;
}

function groupAuditEntriesByDay(
	entries: readonly CenterAgentAuditEntry[],
	canShowBrowserTimeZone: boolean
) {
	const groups = new Map<
		string,
		{ entries: CenterAgentAuditEntry[]; key: string; label: string }
	>();
	for (const entry of entries) {
		const date = new Date(entry.createdAt);
		const key = Number.isNaN(date.getTime())
			? "unknown"
			: formatAuditDayKey(date, canShowBrowserTimeZone);
		const current = groups.get(key);
		if (current) {
			current.entries.push(entry);
			continue;
		}
		groups.set(key, {
			entries: [entry],
			key,
			label: formatAuditDayLabel(date, canShowBrowserTimeZone),
		});
	}
	return [...groups.values()];
}

function formatAuditDayLabel(
	date: Date,
	canShowBrowserTimeZone: boolean
): string {
	if (Number.isNaN(date.getTime())) {
		return "Unknown date";
	}
	const todayKey = formatAuditDayKey(new Date(), canShowBrowserTimeZone);
	const targetKey = formatAuditDayKey(date, canShowBrowserTimeZone);
	const dayDelta = Math.round(
		(Date.parse(`${todayKey}T00:00:00Z`) -
			Date.parse(`${targetKey}T00:00:00Z`)) /
			86_400_000
	);
	if (dayDelta === 0) {
		return "Today";
	}
	if (dayDelta === 1) {
		return "Yesterday";
	}
	return (
		canShowBrowserTimeZone
			? BROWSER_AUDIT_DATE_FORMATTER
			: UTC_AUDIT_DATE_FORMATTER
	).format(date);
}

function formatAuditDayKey(
	date: Date,
	canShowBrowserTimeZone: boolean
): string {
	const parts = (
		canShowBrowserTimeZone
			? BROWSER_AUDIT_DAY_KEY_FORMATTER
			: UTC_AUDIT_DAY_KEY_FORMATTER
	).formatToParts(date);
	const year = parts.find((part) => part.type === "year")?.value;
	const month = parts.find((part) => part.type === "month")?.value;
	const day = parts.find((part) => part.type === "day")?.value;
	return year && month && day ? `${year}-${month}-${day}` : "unknown";
}

function titleCase(value: string): string {
	return value
		.split(TITLE_CASE_WORD_SEPARATOR_PATTERN)
		.filter(Boolean)
		.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
		.join(" ");
}

function formatTime(value: string, canShowBrowserTimeZone: boolean): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "Unknown time";
	}
	return (
		canShowBrowserTimeZone
			? BROWSER_AUDIT_TIME_FORMATTER
			: UTC_AUDIT_TIME_FORMATTER
	).format(date);
}

function subscribeToBrowserEnvironment() {
	return () => undefined;
}

function getBrowserEnvironmentSnapshot(): true {
	return true;
}

function getServerEnvironmentSnapshot(): false {
	return false;
}
