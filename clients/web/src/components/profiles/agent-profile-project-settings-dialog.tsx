"use client";

import type {
	AuthProfileView,
	LocalProjectControlConnection,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { clearPendingAgentProfileCreationLocalSetupForProfile } from "#/lib/profiles/agent-profile-creation-local-setup";
import { updateAgentProfileDefaultProject } from "#/lib/profiles/update-default-project";
import { updateAgentProfileWorkspace } from "#/lib/profiles/update-profile-workspace";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { AgentProfileProjectSelector } from "./agent-profile-project-selector";
import {
	FUTURE_WAKES_PROJECT_SETTINGS_NOTICE,
	shouldShowAgentProfileProjectSettings,
} from "./agent-profile-project-settings";

type SettingsInput = {
	actorProfileId: string | null;
	agentControllerRef: string | null;
	executionTargetChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	currentWorkingFolder: string | null;
	onOpenChange: (open: boolean) => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	profile: AuthProfileView;
};

export function AgentProfileProjectSettingsDialog(input: SettingsInput) {
	if (
		!shouldShowAgentProfileProjectSettings({
			agentControllerRef: input.agentControllerRef,
			managedRole: input.profile.managedRole,
		})
	) {
		return null;
	}
	return (
		<LocalAgentProfileProjectSettingsDialog
			{...input}
			key={`${input.organizationId}:${input.profile.openMeldProfileId}:${input.open}:${input.profile.defaultProjectId === undefined}`}
		/>
	);
}

function LocalAgentProfileProjectSettingsDialog(input: SettingsInput) {
	const projectsQuery = useQuery(
		projectsQueryOptions({
			organizationId: input.organizationId,
			enabled: input.open,
		})
	);
	const initialProjectId = input.profile.defaultProjectId ?? "";
	const initialPath = resolveInitialCustomPath(
		initialProjectId,
		input.currentWorkingFolder
	);
	const initialFallback = initialPath ? "advanced" : "managed";
	const [projectId, setProjectId] = useState(initialProjectId);
	const [fallback, setFallback] = useState<
		"advanced" | "managed" | "project" | null
	>(initialProjectId ? null : initialFallback);
	const [path, setPath] = useState(initialPath);
	const [connection, setConnection] =
		useState<LocalProjectControlConnection | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const disabled =
		pending ||
		input.profile.defaultProjectId === undefined ||
		input.executionTargetChangeEligibilityStatus !== "allowed";
	const valid = isWorkingFolderDraftValid({
		projectId,
		connection,
		fallback,
		path,
	});
	const save = async () => {
		// The displayed choice does not prove that the Service has a usable
		// workspace. Explicit Save may reapply it to initialize or repair it.
		if (disabled || !valid) {
			return;
		}
		setPending(true);
		setError(null);
		const context = {
			actorProfileId: input.actorProfileId,
			organizationId: input.organizationId,
			profileId: input.profile.openMeldProfileId,
		};
		try {
			// Project intent is resolved by the Service's canonical connection. Do not
			// copy its path into a second custom-folder preference.
			if (!projectId) {
				await updateAgentProfileWorkspace({
					...context,
					workspaceMode:
						fallback === "advanced" ? "custom" : "openmeld_managed",
					...(fallback === "advanced" ? { workspacePath: path } : {}),
				});
			}
			const updated = await updateAgentProfileDefaultProject({
				...context,
				defaultProjectId: projectId || null,
			});
			clearPendingAgentProfileCreationLocalSetupForProfile(
				input.profile.openMeldProfileId
			);
			input.onProfileUpdated(updated);
			toast.success("Working folder updated.");
			input.onOpenChange(false);
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Couldn’t save the working folder. Try again."
			);
		} finally {
			setPending(false);
		}
	};
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!pending) {
					input.onOpenChange(open);
				}
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Working folder</DialogTitle>
					<DialogDescription>
						Choose where {input.profile.profileName} starts new work.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					{input.profile.defaultProjectId === undefined ? (
						<output className="text-muted-foreground text-sm">
							Loading the saved working folder…
						</output>
					) : null}
					<AgentProfileProjectSelector
						disabled={disabled}
						manualPath={path}
						onConnectionReady={setConnection}
						onManualPathChange={(value) => {
							setPath(value);
							setError(null);
						}}
						onProjectChange={(value) => {
							setProjectId(value);
							setConnection(null);
							setFallback(null);
							setError(null);
						}}
						onUseAdvancedWorkspace={() => {
							setFallback("advanced");
							setPath(initialPath);
						}}
						onUseManagedWorkspace={() => {
							setFallback("managed");
							setPath("");
						}}
						onUseProjectWorkspace={() => setFallback("project")}
						organizationId={input.organizationId}
						projectId={projectId}
						projects={projectsQuery.data?.projects ?? []}
						selectedBindingGeneration={connection?.bindingGeneration ?? null}
						workspaceFallbackMode={fallback}
					/>
					{projectsQuery.isPending ? (
						<output className="text-muted-foreground text-sm">
							Loading projects…
						</output>
					) : null}
					{projectsQuery.isError ? (
						<p className="text-destructive text-sm" role="alert">
							Couldn’t load projects.{" "}
							<button
								className="underline"
								onClick={() => projectsQuery.refetch()}
								type="button"
							>
								Try again
							</button>
						</p>
					) : null}
					<p className="text-muted-foreground text-xs">
						{FUTURE_WAKES_PROJECT_SETTINGS_NOTICE}
					</p>
					{input.executionTargetChangeEligibilityStatus === "blocked" ? (
						<p className="text-muted-foreground text-sm">
							Working folder changes are unavailable while this Agent is working
							because changing folders would interrupt the current Wake.
						</p>
					) : null}
					{input.executionTargetChangeEligibilityStatus === "unavailable" ? (
						<p className="text-muted-foreground text-sm">
							OpenMeld couldn’t confirm whether this Agent is working. Try
							again.
						</p>
					) : null}
					{error ? (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button
						disabled={pending}
						onClick={() => input.onOpenChange(false)}
						variant="ghost"
					>
						Cancel
					</Button>
					<Button disabled={disabled || !valid} onClick={save}>
						{pending ? "Saving…" : "Save changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function resolveInitialCustomPath(
	projectId: string,
	path: string | null
): string {
	if (projectId || path === "OpenMeld managed") {
		return "";
	}
	return path ?? "";
}

function isWorkingFolderDraftValid(input: {
	projectId: string;
	connection: LocalProjectControlConnection | null;
	fallback: "project" | "advanced" | "managed" | null;
	path: string;
}): boolean {
	if (input.projectId) {
		return input.connection !== null;
	}
	if (input.fallback === "managed") {
		return true;
	}
	return input.fallback === "advanced" && input.path.trim().length > 0;
}
