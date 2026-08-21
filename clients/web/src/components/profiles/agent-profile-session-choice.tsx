"use client";

import type { AgentActivityInventorySession } from "@openmeld/schemas/types";
import { Label } from "@openmeld/ui/components/label";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useId } from "react";

export type AgentProfileSessionMode = "new" | "resume";

export function AgentProfileSessionChoice(input: {
	disabled: boolean;
	isError: boolean;
	isPending: boolean;
	mode: AgentProfileSessionMode;
	onModeChange: (mode: AgentProfileSessionMode) => void;
	onSessionChange: (session: AgentActivityInventorySession) => void;
	selectedSessionKey: string | null;
	sessions: readonly AgentActivityInventorySession[];
}) {
	const headingId = useId();
	const selectableSessions = input.sessions.filter(isResumableSession);
	const selectedSession = selectableSessions.find(
		(session) => sessionKey(session) === input.selectedSessionKey
	);
	const selectDisplayValue = resolveSelectDisplayValue({
		isPending: input.isPending,
		selectedSession,
	});

	return (
		<div className="grid gap-3">
			<p className="font-medium text-foreground text-sm" id={headingId}>
				How should this Agent start?
			</p>
			<RadioGroup
				aria-disabled={input.disabled || undefined}
				aria-labelledby={headingId}
				className="w-full gap-1"
				orientation="horizontal"
				selectedIndex={input.mode === "new" ? 0 : 1}
			>
				<RadioItem
					className="min-w-0 flex-1 px-4 py-3"
					description="Open a fresh Session with the local agent you choose below."
					index={0}
					label="Start new"
					onSelect={() => {
						if (!input.disabled) {
							input.onModeChange("new");
						}
					}}
					selected={input.mode === "new"}
				/>
				<RadioItem
					className="min-w-0 flex-1 px-4 py-3"
					description="Continue the context from one visible Local Agent Session."
					index={1}
					label="Use existing"
					onSelect={() => {
						if (!input.disabled) {
							input.onModeChange("resume");
						}
					}}
					selected={input.mode === "resume"}
				/>
			</RadioGroup>
			{input.mode === "resume" ? (
				<div className="grid gap-2">
					<Label htmlFor="create-agent-session-select">Session</Label>
					<Select
						disabled={input.disabled || input.isPending}
						onValueChange={(value) => {
							const session = selectableSessions.find(
								(candidate) => sessionKey(candidate) === value
							);
							if (session) {
								input.onSessionChange(session);
							}
						}}
						value={input.selectedSessionKey ?? ""}
					>
						<SelectTrigger
							displayValue={selectDisplayValue}
							id="create-agent-session-select"
						/>
						<SelectContent>
							{selectableSessions.map((session, index) => (
								<SelectItem
									index={index}
									key={sessionKey(session)}
									value={sessionKey(session)}
								>
									{sessionLabel(session)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<SessionChoiceHelp
						isError={input.isError}
						isPending={input.isPending}
						selectableSessionCount={selectableSessions.length}
						selectedSession={selectedSession}
					/>
				</div>
			) : null}
		</div>
	);
}

export function agentActivitySessionKey(
	session: AgentActivityInventorySession
): string {
	return sessionKey(session);
}

function SessionChoiceHelp(input: {
	isError: boolean;
	isPending: boolean;
	selectableSessionCount: number;
	selectedSession: AgentActivityInventorySession | undefined;
}) {
	if (input.isPending) {
		return (
			<p className="text-muted-foreground text-xs leading-5">
				Loading visible Sessions from Agent Activity.
			</p>
		);
	}
	if (input.isError) {
		return (
			<p className="text-destructive text-xs leading-5">
				OpenMeld couldn’t load this owner’s Sessions. Try again in a moment.
			</p>
		);
	}
	if (input.selectableSessionCount === 0) {
		return (
			<p className="text-muted-foreground text-xs leading-5">
				No current, unconnected, resumable Sessions are visible for this owner.
			</p>
		);
	}
	if (input.selectedSession?.status === "working") {
		return (
			<p className="text-amber-700 text-xs leading-5 dark:text-amber-300">
				This Session is working now. Resume may add new work to the same
				conversation; use Fork when this local agent supports it.
			</p>
		);
	}
	return (
		<p className="text-muted-foreground text-xs leading-5">
			The Agent Profile will continue this Session’s native context.
		</p>
	);
}

function isResumableSession(session: AgentActivityInventorySession): boolean {
	return (
		session.bindingState === "unbound" &&
		session.canResume &&
		session.dataState === "current"
	);
}

function sessionKey(session: AgentActivityInventorySession): string {
	return `${session.computer.id}:${session.localAgent.agentControllerRef}:${session.nativeSessionId}`;
}

function sessionLabel(session: AgentActivityInventorySession): string {
	return `${session.nativeSessionTitle ?? session.nativeSessionId} · ${session.localAgent.name} · ${session.project.name}`;
}

function resolveSelectDisplayValue(input: {
	isPending: boolean;
	selectedSession: AgentActivityInventorySession | undefined;
}): string {
	if (input.selectedSession) {
		return sessionLabel(input.selectedSession);
	}
	return input.isPending ? "Loading Sessions…" : "Choose a Session";
}
