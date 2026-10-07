"use client";

import {
	createAgentActivityApi,
	createSessionHistoryApi,
} from "@openmeld/api-client";
import type {
	AgentActivityInventoryCoverage,
	AgentActivityInventorySession,
	PeopleComputerTarget,
	SessionHistoryOperation,
	SessionHistoryResult,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Card, CardContent, CardTitle } from "@openmeld/ui/components/card";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@openmeld/ui/components/sheet";
import { Switch } from "@openmeld/ui/components/switch";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

type Settings = Extract<SessionHistoryResult, { kind: "settings" }>;
type Session = Extract<SessionHistoryResult, { kind: "session" }>;
type Audit = Extract<SessionHistoryResult, { kind: "audit" }>;

type Props = PeopleComputerTarget & {
	organizationId: string;
	computerId: string;
	profiles: readonly { openMeldProfileId: string; profileName: string }[];
};
function useConversationAccess(input: Props, open: boolean) {
	// Private responses stay in mounted component memory, never the persisted
	// query cache. Opening the page loads metadata only, not conversation bodies.
	const [settings, setSettings] = useState<Settings | null>(null);
	const [audit, setAudit] = useState<Audit | null>(null);
	const [sessions, setSessions] = useState<AgentActivityInventorySession[]>([]);
	const [coverage, setCoverage] = useState<AgentActivityInventoryCoverage[]>(
		[]
	);
	const [cursor, setCursor] = useState<string | null>(null);
	const [sessionsLoading, setSessionsLoading] = useState(true);
	const [settingsError, setSettingsError] = useState<string | null>(null);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [auditError, setAuditError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [selected, setSelected] =
		useState<AgentActivityInventorySession | null>(null);
	const [history, setHistory] = useState<Session | null>(null);
	const [reading, setReading] = useState(false);
	const [readError, setReadError] = useState<string | null>(null);
	const readGeneration = useRef(0);
	const saveLock = useRef(false);
	const foundation = useMemo(
		() =>
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			}),
		[input.organizationId]
	);
	const request = useCallback(
		async (operation: SessionHistoryOperation) => {
			const result = await createSessionHistoryApi(foundation).request({
				deviceId: input.deviceId,
				runtimeLane: input.runtimeLane,
				organizationId: input.organizationId,
				request: operation,
			});
			if (result.kind === "error") {
				throw new Error(result.message);
			}
			return result;
		},
		[foundation, input.deviceId, input.runtimeLane, input.organizationId]
	);
	const loadSettings = useCallback(async () => {
		setSettingsError(null);
		try {
			const result = await request({ operation: "read_settings" });
			if (result.kind === "settings") {
				setSettings(result);
			}
		} catch (error) {
			setSettingsError(errorText(error));
		}
	}, [request]);
	const loadAudit = useCallback(async () => {
		setAuditError(null);
		try {
			const result = await request({ operation: "read_audit" });
			if (result.kind === "audit") {
				setAudit(result);
			}
		} catch (error) {
			setAuditError(errorText(error));
		}
	}, [request]);
	const loadSessions = useCallback(
		async (next?: string) => {
			setSessionsLoading(true);
			setSessionsError(null);
			try {
				const result = await createAgentActivityApi(foundation).readSessions({
					computerId: input.computerId,
					provider: "codex",
					limit: 50,
					...(next ? { cursor: next } : {}),
				});
				setSessions((previous) =>
					next ? [...previous, ...result.sessions] : result.sessions
				);
				setCoverage(result.coverage);
				setCursor(result.nextCursor);
			} catch (error) {
				setSessionsError(errorText(error));
			} finally {
				setSessionsLoading(false);
			}
		},
		[foundation, input.computerId]
	);
	useEffect(() => {
		loadSettings();
		return () => {
			readGeneration.current += 1;
		};
	}, [loadSettings]);
	useEffect(() => {
		if (open) {
			loadSessions();
			loadAudit();
		}
	}, [open, loadSessions, loadAudit]);
	function closeHistory() {
		readGeneration.current += 1;
		setSelected(null);
		setHistory(null);
		setReadError(null);
		setReading(false);
	}
	async function save(policy: Settings["policy"]) {
		if (!settings || saveLock.current) {
			return;
		}
		saveLock.current = true;
		setSaving(true);
		setSettingsError(null);
		closeHistory();
		try {
			const result = await request({
				operation: "update_settings",
				expectedRevision: settings.policy.revision,
				policy: { enabled: policy.enabled, connections: policy.connections },
			});
			if (result.kind === "settings") {
				setSettings(result);
			}
		} catch (error) {
			setSettingsError(errorText(error));
		} finally {
			saveLock.current = false;
			setSaving(false);
		}
	}
	async function read(session: AgentActivityInventorySession, offset = 0) {
		const generation = ++readGeneration.current;
		setSelected(session);
		if (offset === 0) {
			setHistory(null);
		}
		setReading(true);
		setReadError(null);
		try {
			const result = await request({
				operation: "read_session",
				projectId: session.project.id,
				sessionId: session.nativeSessionId,
				offset,
				limit: 20,
			});
			if (generation === readGeneration.current && result.kind === "session") {
				setHistory((previous) =>
					offset > 0 && previous
						? {
								...result,
								messages: [...previous.messages, ...result.messages],
							}
						: result
				);
			}
		} catch (error) {
			if (generation === readGeneration.current) {
				setReadError(errorText(error));
			}
		} finally {
			if (generation === readGeneration.current) {
				setReading(false);
			}
			loadAudit();
		}
	}

	return {
		settings,
		audit,
		sessions,
		coverage,
		cursor,
		sessionsLoading,
		settingsError,
		sessionsError,
		auditError,
		saving,
		selected,
		history,
		reading,
		readError,
		loadSettings,
		loadAudit,
		loadSessions,
		save,
		read,
		closeHistory,
	};
}
type State = ReturnType<typeof useConversationAccess>;
export function ComputerSessionHistoryCard(input: Props) {
	const [open, setOpen] = useState(false);
	const state = useConversationAccess(input, open);
	return (
		<Sheet
			onOpenChange={(value) => {
				setOpen(value);
				if (!value) {
					state.closeHistory();
				}
			}}
			open={open}
		>
			<Card>
				<CardContent className="space-y-4 pt-4">
					<AccessSettings state={state} />
					<SheetTrigger render={<Button size="sm" variant="secondary" />}>
						View conversations &amp; history
					</SheetTrigger>
				</CardContent>
			</Card>
			<SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
				{state.selected ? (
					<>
						<div className="px-4 pt-4 pr-12">
							<Button
								onClick={state.closeHistory}
								size="sm"
								variant="secondary"
							>
								Back to conversations
							</Button>
						</div>
						<ConversationReader state={state} />
					</>
				) : (
					<>
						<SheetHeader className="pr-12">
							<SheetTitle>Conversations &amp; access history</SheetTitle>
							<SheetDescription>
								Conversations on this computer and recent reads. Currently
								supports Codex.
							</SheetDescription>
						</SheetHeader>
						<ScrollArea
							className="min-h-0 flex-1"
							contentClassName="space-y-4 p-4"
							viewportProps={{
								"aria-label": "Conversations and access history",
							}}
						>
							<ConversationList state={state} />
							<AccessLog profiles={input.profiles} state={state} />
						</ScrollArea>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}
function AccessSettings({ state }: { state: State }) {
	const { settings, saving, settingsError, save, loadSettings } = state;
	const enabled = settings?.policy.enabled === true;
	const grants = settings?.policy.connections ?? [];
	return (
		<section aria-label="Conversation access settings" className="space-y-4">
			<div className="flex items-center justify-between gap-4">
				<CardTitle id="conversation-access-label">
					Conversation access
				</CardTitle>
				<Switch
					aria-describedby="conversation-access-help"
					aria-labelledby="conversation-access-label"
					checked={enabled}
					disabled={!settings || saving || (!enabled && grants.length === 0)}
					onCheckedChange={(value) =>
						settings && save({ ...settings.policy, enabled: value })
					}
				/>
			</div>
			<p
				className="text-muted-foreground text-sm"
				id="conversation-access-help"
			>
				Read local conversations yourself or through agents acting for you.
				Currently supports Codex.
			</p>
			{saving || !(settings || settingsError) ? (
				<output className="block text-muted-foreground text-xs">
					{saving ? "Saving…" : "Connecting…"}
				</output>
			) : null}
			<ProjectAccess state={state} />
			{settingsError ? (
				<LoadError message={settingsError} retry={loadSettings} />
			) : null}
			<p className="max-w-3xl text-muted-foreground text-xs leading-relaxed">
				Read on demand. Agents may share or retain what they read.
			</p>
		</section>
	);
}
function ProjectAccess({ state }: { state: State }) {
	const { settings, saving, save } = state;
	if (!settings) {
		return null;
	}
	const grants = settings.policy.connections;
	return (
		<fieldset className="space-y-2" disabled={saving}>
			<legend className="font-medium text-sm">Allowed projects</legend>
			{settings.connections.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Connect a project to this computer to enable access.
				</p>
			) : null}
			<ScrollArea
				className="-mr-3 max-h-40"
				viewportProps={{
					"aria-label": "Projects available for conversation access",
				}}
			>
				<div className="space-y-1 pr-3">
					{settings.connections.map((connection) => {
						const checked = grants.some(
							(grant) =>
								grant.projectId === connection.projectId &&
								grant.bindingGeneration === connection.bindingGeneration
						);
						return (
							<label
								className="flex items-center justify-between gap-4 py-2 text-sm"
								htmlFor={`history-project-${connection.bindingGeneration}`}
								key={connection.bindingGeneration}
							>
								<span className="min-w-0 break-words">
									{connection.projectSlug}
								</span>
								<Switch
									aria-label={`Allow conversations in ${connection.projectSlug}`}
									checked={checked}
									disabled={saving}
									id={`history-project-${connection.bindingGeneration}`}
									onCheckedChange={(value) => {
										const connections = value
											? [
													...grants,
													{
														projectId: connection.projectId,
														bindingGeneration: connection.bindingGeneration,
													},
												]
											: grants.filter(
													(grant) =>
														grant.bindingGeneration !==
														connection.bindingGeneration
												);
										return save({
											...settings.policy,
											connections,
											enabled:
												settings.policy.enabled && connections.length > 0,
										});
									}}
								/>
							</label>
						);
					})}
				</div>
			</ScrollArea>
			{grants.length === 0 && settings.connections.length > 0 ? (
				<p className="text-muted-foreground text-xs">
					Select a project to enable access.
				</p>
			) : null}
		</fieldset>
	);
}
function ConversationList({ state }: { state: State }) {
	const {
		sessions,
		sessionsLoading,
		sessionsError,
		coverage,
		cursor,
		loadSessions,
	} = state;
	const notice = inventoryNotice(coverage);
	return (
		<section aria-label="Conversations" className="space-y-2 border-t pt-4">
			<div className="flex items-center justify-between gap-3">
				<h3 className="font-medium text-sm">Conversations</h3>
				<Button
					disabled={sessionsLoading}
					onClick={() => loadSessions()}
					size="sm"
					variant="secondary"
				>
					Refresh
				</Button>
			</div>
			{sessionsError ? (
				<LoadError message={sessionsError} retry={() => loadSessions()} />
			) : null}
			{!sessionsError && notice && !sessionsLoading ? (
				<output className="block text-muted-foreground text-sm">
					{notice}
				</output>
			) : null}
			{sessionsLoading && sessions.length === 0 ? (
				<p className="text-muted-foreground text-sm">Loading conversations…</p>
			) : null}
			{!sessionsLoading &&
			sessions.length === 0 &&
			!sessionsError &&
			!notice ? (
				<p className="text-muted-foreground text-sm">
					No Codex conversations found in connected projects.
				</p>
			) : null}
			<ul className="divide-y">
				{sessions.map((session) => (
					<ConversationRow
						key={`${session.project.id}/${session.nativeSessionId}`}
						session={session}
						state={state}
					/>
				))}
			</ul>
			{cursor ? (
				<Button
					disabled={sessionsLoading}
					onClick={() => loadSessions(cursor)}
					size="sm"
					variant="secondary"
				>
					{sessionsLoading ? "Loading…" : "Load more conversations"}
				</Button>
			) : null}
		</section>
	);
}
function ConversationRow({
	state,
	session,
}: {
	state: State;
	session: AgentActivityInventorySession;
}) {
	const { settings, saving, read } = state;
	const allowed =
		settings?.policy.enabled &&
		settings.policy.connections.some(
			(grant) =>
				grant.projectId === session.project.id &&
				settings.connections.some(
					(connection) =>
						connection.projectId === grant.projectId &&
						connection.bindingGeneration === grant.bindingGeneration
				)
		);
	return (
		<li className="flex items-center justify-between gap-4 py-3">
			<div className="min-w-0 space-y-1">
				<p
					className="truncate text-sm"
					title={session.nativeSessionTitle ?? undefined}
				>
					{session.nativeSessionTitle ?? "Untitled conversation"}
				</p>
				<p className="text-muted-foreground text-xs">
					Codex · {session.project.name}
					{session.dataState === "stale" ? " · Last known conversation" : ""}
					{settings?.policy.enabled && !allowed ? " · Project access off" : ""}
				</p>
			</div>
			<Button
				aria-label={`Read ${session.nativeSessionTitle ?? "conversation"}`}
				disabled={!allowed || saving}
				onClick={() => read(session)}
				size="sm"
				variant="secondary"
			>
				Read
			</Button>
		</li>
	);
}
function AccessLog({
	state,
	profiles,
}: {
	state: State;
	profiles: Props["profiles"];
}) {
	const { audit, auditError, loadAudit, sessions } = state;
	return (
		<section aria-label="Recent access" className="space-y-2 border-t pt-4">
			<div className="flex items-center justify-between gap-3">
				<h3 className="font-medium text-sm">Recent access</h3>
				<Button onClick={loadAudit} size="sm" variant="secondary">
					Refresh
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				Stored locally. No message content.
			</p>
			{auditError ? <LoadError message={auditError} retry={loadAudit} /> : null}
			{auditError || audit ? null : (
				<p className="text-muted-foreground text-sm">Loading recent access…</p>
			)}
			{audit?.entries.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No reads yet. Requests from you and your agents will appear here.
				</p>
			) : null}
			<ul className="divide-y">
				{audit?.entries.map((entry) => (
					<AccessLogRow
						entry={entry}
						key={entry.requestId}
						profiles={profiles}
						sessions={sessions}
					/>
				))}
			</ul>
		</section>
	);
}
function AccessLogRow({
	entry,
	sessions,
	profiles,
}: {
	entry: Audit["entries"][number];
	sessions: State["sessions"];
	profiles: Props["profiles"];
}) {
	const session = sessions.find(
		(item) =>
			item.nativeSessionId === entry.sessionId &&
			item.project.id === entry.projectId
	);
	const humanReader =
		entry.requester.requesterUserId === entry.requester.ownerUserId
			? "You"
			: "Another member";
	const reader = entry.requester.readerProfileId
		? (profiles.find(
				(profile) =>
					profile.openMeldProfileId === entry.requester.readerProfileId
			)?.profileName ?? "Agent")
		: humanReader;
	const outcomes = {
		allowed: "Read allowed",
		denied: "Access denied",
		failed: "Read failed",
	};
	const audiences = {
		owner_private: "Private request",
		space: "Requested in a Space",
		externally_shared: "External request",
	};
	return (
		<li className="space-y-1 py-3 text-sm">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<span className="font-medium">
					{reader}{" "}
					<span className="font-normal text-muted-foreground">
						· {outcomes[entry.outcome]}
					</span>
				</span>
				<time
					className="text-muted-foreground text-xs"
					dateTime={new Date(entry.atMs).toISOString()}
				>
					{new Date(entry.atMs).toLocaleString()}
				</time>
			</div>
			<p className="truncate">
				{session?.nativeSessionTitle ?? "Codex conversation"}
			</p>
			<p className="text-muted-foreground text-xs">
				{entry.count} {entry.count === 1 ? "message" : "messages"} ·{" "}
				{audiences[entry.requester.audience]}
			</p>
		</li>
	);
}
function ConversationReader({ state }: { state: State }) {
	const { selected, history, reading, readError, read } = state;
	return (
		<>
			<SheetHeader className="pr-12">
				<SheetTitle>
					{selected?.nativeSessionTitle ?? "Conversation"}
				</SheetTitle>
				<SheetDescription>
					{selected?.project.name} · Read-only Codex conversation
				</SheetDescription>
			</SheetHeader>
			<ScrollArea
				className="min-h-0 flex-1"
				contentClassName="space-y-5 p-4"
				viewportProps={{ "aria-label": "Conversation messages" }}
			>
				<p className="text-muted-foreground text-xs">
					Only user and assistant messages are shown. Tool output, internal
					reasoning, and attachments are omitted.
				</p>
				{history?.messages.map((message, index) => (
					<div
						className="space-y-2"
						key={`${selected?.nativeSessionId}/${index}`}
					>
						<p className="font-medium text-xs">
							{message.role === "user" ? "You" : "Codex"}
						</p>
						<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
							{message.text}
							{message.truncated ? "\n[Message shortened]" : ""}
						</p>
					</div>
				))}
				{history?.messages.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No user or assistant messages in this conversation.
					</p>
				) : null}
				{reading ? (
					<output className="block text-muted-foreground text-sm">
						Reading from this computer…
					</output>
				) : null}
				{readError ? (
					<p className="text-destructive text-sm" role="alert">
						{readError}
					</p>
				) : null}
				{history && history.nextOffset !== null && selected ? (
					<Button
						disabled={reading}
						onClick={() => read(selected, history.nextOffset ?? 0)}
						size="sm"
						variant="secondary"
					>
						Load more messages
					</Button>
				) : null}
			</ScrollArea>
		</>
	);
}
function errorText(error: unknown) {
	return error instanceof Error
		? error.message
		: "Could not connect to this computer. Check that it is online and try again.";
}
function LoadError(input: { message: string; retry: () => Promise<void> }) {
	return (
		<div className="flex items-center gap-3 text-sm" role="alert">
			<p className="text-destructive">{input.message}</p>
			<Button onClick={input.retry} size="sm" variant="secondary">
				Try again
			</Button>
		</div>
	);
}
function inventoryNotice(coverage: AgentActivityInventoryCoverage[]) {
	if (coverage.some((source) => source.state === "error")) {
		return "Codex discovery failed. Check Codex on this computer, then refresh. Listed conversations may be out of date.";
	}
	if (coverage.some((source) => source.state === "disconnected")) {
		return "A project is disconnected. Reconnect it to update its conversations.";
	}
	if (coverage.some((source) => source.state === "unsupported")) {
		return "Update OpenMeld on this computer to discover Codex conversations.";
	}
	if (
		coverage.length === 0 ||
		coverage.some((source) => source.state !== "current")
	) {
		return "Waiting for an up-to-date list. Make sure this computer is online and has a connected project.";
	}
	return null;
}
