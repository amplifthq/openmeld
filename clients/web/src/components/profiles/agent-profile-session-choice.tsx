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

export type AgentProfileSessionMode = "fork" | "new" | "resume";

export function AgentProfileSessionChoice(input: {
	disabled: boolean;
	isError: boolean;
	isPending: boolean;
	mode: AgentProfileSessionMode;
	onModeChange: (mode: AgentProfileSessionMode) => void;
	onSessionChange: (
		session: AgentActivityInventorySession,
		mode: Exclude<AgentProfileSessionMode, "new">
	) => void;
	selectedSessionKey: string | null;
	sessions: readonly AgentActivityInventorySession[];
}) {
	const headingId = useId();
	const selectableSessions = input.sessions.filter(isReusableSession);
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
							input.onModeChange(input.mode === "new" ? "resume" : input.mode);
						}
					}}
					selected={input.mode !== "new"}
				/>
			</RadioGroup>
			{input.mode !== "new" ? (
				<div className="grid gap-2">
					<Label htmlFor="create-agent-session-select">Session</Label>
					<Select
						disabled={input.disabled || input.isPending}
						onValueChange={(value) => {
							const session = selectableSessions.find(
								(candidate) => sessionKey(candidate) === value
							);
							if (session) {
								input.onSessionChange(session, defaultReuseMode(session));
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
					{selectedSession ? (
						<SessionReuseStrategy
							disabled={input.disabled}
							mode={input.mode === "fork" ? "fork" : "resume"}
							onModeChange={input.onModeChange}
							session={selectedSession}
						/>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function SessionReuseStrategy(input: {
	disabled: boolean;
	mode: Exclude<AgentProfileSessionMode, "new">;
	onModeChange: (mode: AgentProfileSessionMode) => void;
	session: AgentActivityInventorySession;
}) {
	return (
		<div className="grid gap-2 pt-1">
			<Label>Use this Session by</Label>
			<RadioGroup
				aria-disabled={input.disabled || undefined}
				className="w-full gap-1"
				orientation="horizontal"
				selectedIndex={input.mode === "resume" ? 0 : 1}
			>
				<RadioItem
					aria-disabled={!canResume(input.session) || undefined}
					className="min-w-0 flex-1 px-4 py-3"
					description="Continue the same native Session."
					index={0}
					label="Resume"
					onSelect={() => {
						if (!(input.disabled || !canResume(input.session))) {
							input.onModeChange("resume");
						}
					}}
					selected={input.mode === "resume"}
				/>
				<RadioItem
					aria-disabled={!input.session.canFork || undefined}
					className="min-w-0 flex-1 px-4 py-3"
					description="Copy its context into a new native Session."
					index={1}
					label="Fork"
					onSelect={() => {
						if (!(input.disabled || !input.session.canFork)) {
							input.onModeChange("fork");
						}
					}}
					selected={input.mode === "fork"}
				/>
			</RadioGroup>
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
				No reusable Sessions are visible for this owner.
			</p>
		);
	}
	if (input.selectedSession?.status === "working") {
		return (
			<p className="text-amber-700 text-xs leading-5 dark:text-amber-300">
				This Session is working now. Fork keeps the current conversation intact;
				Resume continues it directly.
			</p>
		);
	}
	return (
		<p className="text-muted-foreground text-xs leading-5">
			Choose Resume to continue this Session, or Fork to create a separate copy
			when available.
		</p>
	);
}

function isReusableSession(session: AgentActivityInventorySession): boolean {
	return (
		session.dataState === "current" && (canResume(session) || session.canFork)
	);
}

function canResume(session: AgentActivityInventorySession): boolean {
	return session.bindingState === "unbound" && session.canResume;
}

function defaultReuseMode(
	session: AgentActivityInventorySession
): Exclude<AgentProfileSessionMode, "new"> {
	if (session.status === "working" && session.canFork) {
		return "fork";
	}
	return canResume(session) ? "resume" : "fork";
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
