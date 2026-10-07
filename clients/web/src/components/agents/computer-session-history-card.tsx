"use client";

import {
	createAgentActivityApi,
	createSessionHistoryApi,
} from "@openmeld/api-client";
import type {
	AgentActivityInventorySession,
	PeopleComputerTarget,
	SessionHistoryOperation,
	SessionHistoryResult,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Switch } from "@openmeld/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { centerAgentDesignationQueryOptions } from "#/query/organizations/center-agent";

type Settings = Extract<SessionHistoryResult, { kind: "settings" }>;
type Session = Extract<SessionHistoryResult, { kind: "session" }>;

export function ComputerSessionHistoryCard(
	input: PeopleComputerTarget & {
		organizationId: string;
		computerId: string;
		profiles: readonly { openMeldProfileId: string; profileName: string }[];
	}
) {
	// Private response bodies live only in this mounted component. Do not move
	// these into the persisted query cache or a route loader.
	const [settings, setSettings] = useState<Settings | null>(null);
	const [audit, setAudit] = useState<Extract<
		SessionHistoryResult,
		{ kind: "audit" }
	> | null>(null);
	const [sessions, setSessions] = useState<AgentActivityInventorySession[]>([]);
	const [sessionsLoaded, setSessionsLoaded] = useState(false);
	const [cursor, setCursor] = useState<string | null>(null);
	const [history, setHistory] = useState<Session | null>(null);
	const [selected, setSelected] =
		useState<AgentActivityInventorySession | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const centerAgent = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: settings !== null,
			organizationId: input.organizationId,
		})
	).data?.designation;
	const profiles =
		centerAgent &&
		!input.profiles.some(
			(profile) => profile.openMeldProfileId === centerAgent.agentProfileId
		)
			? [
					...input.profiles,
					{
						openMeldProfileId: centerAgent.agentProfileId,
						profileName: "Center Agent",
					},
				]
			: input.profiles;
	const foundation = () =>
		createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		});
	async function run(operation: () => Promise<void>) {
		setBusy(true);
		setError(null);
		try {
			await operation();
		} catch {
			setError(
				"This request failed. Check the Computer connection and try again."
			);
		} finally {
			setBusy(false);
		}
	}
	async function request(request: SessionHistoryOperation) {
		const response = await createSessionHistoryApi(foundation()).request({
			deviceId: input.deviceId,
			runtimeLane: input.runtimeLane,
			organizationId: input.organizationId,
			request,
		});
		if (response.kind === "error") {
			setError(response.message);
			return;
		}
		if (response.kind === "settings") {
			setSettings(response);
		}
		if (response.kind === "audit") {
			setAudit(response);
		}
		if (response.kind === "session") {
			setHistory(response);
		}
	}
	async function listSessions(next?: string) {
		const response = await createAgentActivityApi(foundation()).readSessions({
			provider: "codex",
			limit: 100,
			...(next ? { cursor: next } : {}),
		});
		const rows = response.sessions.filter(
			(session) => session.computer.id === input.computerId
		);
		setSessions((previous) => (next ? [...previous, ...rows] : rows));
		setCursor(response.nextCursor);
		setSessionsLoaded(true);
	}
	function read(session: AgentActivityInventorySession, offset = 0) {
		setHistory(null);
		setSelected(session);
		return run(() =>
			request({
				operation: "read_session",
				projectId: session.project.id,
				sessionId: session.nativeSessionId,
				offset,
				limit: 20,
			})
		);
	}
	return (
		<Card>
			<CardHeader>
				<CardTitle>Session history access</CardTitle>
				<CardDescription>
					Read Codex conversations from this computer, including sessions
					outside OpenMeld. Access is off until you enable it for selected
					projects.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground text-sm">
					History is read on demand, not synced to OpenMeld. Agent conversations
					and model providers may retain results. File access restrictions still
					apply.
				</p>
				{error ? (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				) : null}
				{settings ? (
					<>
						<div className="flex items-center justify-between gap-3 text-sm">
							Allow session history reads
							<Switch
								aria-label="Allow session history reads"
								checked={settings.policy.enabled}
								disabled={busy}
								onCheckedChange={(enabled) =>
									setSettings({
										...settings,
										policy: { ...settings.policy, enabled },
									})
								}
							/>
						</div>
						<fieldset className="space-y-2" disabled={busy}>
							<legend className="mb-2 font-medium text-sm">
								Connected projects
							</legend>
							{settings.connections.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									Connect a project on this computer first.
								</p>
							) : (
								settings.connections.map((connection) => {
									const checked = settings.policy.connections.some(
										(grant) =>
											grant.bindingGeneration === connection.bindingGeneration
									);
									return (
										<div
											className="flex items-center justify-between gap-3 text-sm"
											key={connection.bindingGeneration}
										>
											{connection.projectSlug}
											<Switch
												aria-label={`Allow history for ${connection.projectSlug}`}
												checked={checked}
												onCheckedChange={(enabled) =>
													setSettings({
														...settings,
														policy: {
															...settings.policy,
															connections: enabled
																? [
																		...settings.policy.connections,
																		{
																			projectId: connection.projectId,
																			bindingGeneration:
																				connection.bindingGeneration,
																		},
																	]
																: settings.policy.connections.filter(
																		(grant) =>
																			grant.bindingGeneration !==
																			connection.bindingGeneration
																	),
														},
													})
												}
											/>
										</div>
									);
								})
							)}
						</fieldset>
						<fieldset className="space-y-2" disabled={busy}>
							<legend className="mb-2 font-medium text-sm">
								Agents allowed to read for you
							</legend>
							<p className="text-muted-foreground text-sm">
								Agents must also have a verified request from you. Other members
								do not get access.
							</p>
							{profiles.map((profile) => (
								<div
									className="flex items-center justify-between gap-3 text-sm"
									key={profile.openMeldProfileId}
								>
									{profile.profileName}
									<Switch
										aria-label={`Allow ${profile.profileName} to read history`}
										checked={settings.policy.readerProfileIds.includes(
											profile.openMeldProfileId
										)}
										onCheckedChange={(enabled) =>
											setSettings({
												...settings,
												policy: {
													...settings.policy,
													readerProfileIds: enabled
														? [
																...settings.policy.readerProfileIds,
																profile.openMeldProfileId,
															]
														: settings.policy.readerProfileIds.filter(
																(id) => id !== profile.openMeldProfileId
															),
												},
											})
										}
									/>
								</div>
							))}
						</fieldset>
						<div className="flex flex-wrap gap-2">
							<Button
								disabled={busy}
								onClick={() => {
									setHistory(null);
									return run(() =>
										request({
											operation: "update_settings",
											expectedRevision: settings.policy.revision,
											policy: {
												enabled: settings.policy.enabled,
												connections: settings.policy.connections,
												readerProfileIds: settings.policy.readerProfileIds,
											},
										})
									);
								}}
							>
								Save access
							</Button>
							<Button
								disabled={busy}
								onClick={() =>
									run(() => request({ operation: "read_settings" }))
								}
								variant="outline"
							>
								Reload settings
							</Button>
							<Button
								disabled={busy}
								onClick={() => run(() => listSessions())}
								variant="outline"
							>
								Browse Codex sessions
							</Button>
							<Button
								disabled={busy}
								onClick={() => run(() => request({ operation: "read_audit" }))}
								variant="outline"
							>
								Access history
							</Button>
						</div>
					</>
				) : (
					<Button
						disabled={busy}
						onClick={() => run(() => request({ operation: "read_settings" }))}
						variant="outline"
					>
						Manage history access
					</Button>
				)}
				{sessionsLoaded && sessions.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No Codex sessions found on this computer.
					</p>
				) : null}
				{sessions.length > 0 ? (
					<ul className="space-y-2">
						{sessions.map((session) => (
							<li
								className="flex items-center justify-between gap-3 text-sm"
								key={`${session.project.id}/${session.nativeSessionId}`}
							>
								<span>
									{session.nativeSessionTitle ?? "Untitled Codex session"}
									<span className="ml-2 text-muted-foreground">
										{session.project.name}
									</span>
								</span>
								<Button
									disabled={busy}
									onClick={() => read(session)}
									size="sm"
									variant="outline"
								>
									Read history
								</Button>
							</li>
						))}
					</ul>
				) : null}
				{cursor ? (
					<Button
						disabled={busy}
						onClick={() => run(() => listSessions(cursor))}
						variant="outline"
					>
						Check more sessions
					</Button>
				) : null}
				{history ? (
					<section
						aria-label="Session history"
						className="space-y-3 border-t pt-3"
					>
						<div className="flex items-center justify-between">
							<p className="font-medium text-sm">
								{selected?.nativeSessionTitle ?? "Session history"}
							</p>
							<Button
								disabled={busy}
								onClick={() => setHistory(null)}
								size="sm"
								variant="ghost"
							>
								Close history
							</Button>
						</div>
						<p className="text-muted-foreground text-xs">
							User and assistant messages only. Tool output, internal reasoning,
							and attachments are omitted.
						</p>
						{history.messages.length === 0 ? (
							<p className="text-sm">No messages in this range.</p>
						) : (
							history.messages.map((message, index) => (
								<div
									className="space-y-1"
									key={`${selected?.nativeSessionId}/${index}`}
								>
									<p className="font-medium text-xs">
										{message.role === "user" ? "User" : "Agent"}
									</p>
									<p className="whitespace-pre-wrap break-words text-sm">
										{message.text}
										{message.truncated ? "\n[Message shortened]" : ""}
									</p>
								</div>
							))
						)}
						{history.nextOffset !== null && selected ? (
							<Button
								disabled={busy}
								onClick={() => read(selected, history.nextOffset ?? 0)}
								variant="outline"
							>
								Read next messages
							</Button>
						) : null}
					</section>
				) : null}
				{audit ? (
					<section
						aria-label="Access history"
						className="space-y-2 border-t pt-3"
					>
						<p className="font-medium text-sm">Recent access</p>
						<p className="text-muted-foreground text-xs">
							The latest 200 requests on this computer. No message content is
							recorded.
						</p>
						{audit.entries.length === 0 ? (
							<p className="text-sm">No history reads yet.</p>
						) : (
							audit.entries.map((entry) => (
								<p className="break-words text-xs" key={entry.requestId}>
									{new Date(entry.atMs).toLocaleString()} · {entry.outcome} ·{" "}
									{entry.requester.readerProfileId ?? "You"} · {entry.sessionId}{" "}
									· {entry.count} messages ·{" "}
									{entry.requester.audience === "owner_private"
										? "Private"
										: `Shared · ${entry.requester.spaceId ?? "External conversation"}`}
								</p>
							))
						)}
					</section>
				) : null}
			</CardContent>
		</Card>
	);
}
