"use client";

import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { desktopLocalComputerSchema } from "@openmeld/schemas";
import type {
	AgentProfileBindingTarget,
	AuthProfileView,
	GetAgentProfileFoldersResponse,
	LocalFolderPickerResult,
	PeopleComputerTarget,
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
import { useQueryClient } from "@tanstack/react-query";
import {
	type ReactNode,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { getDesktopPlatform } from "#/desktop/platform";
import { selectPeopleComputerFolders } from "#/lib/connect/local-folder-picker";
import { clearPendingAgentProfileCreationLocalSetupForProfile } from "#/lib/profiles/agent-profile-creation-local-setup";
import { manageAgentProfileFolders } from "#/lib/profiles/agent-profile-folders";
import { updateAgentProfileDefaultProject } from "#/lib/profiles/update-default-project";
import { agentProfileFoldersQueryOptions } from "#/query/profiles/agent-profile-folders";

type DirectFolderFlowInput = {
	actorProfileId: string | null;
	eligibility: "allowed" | "blocked" | "unavailable";
	expectedBindingTarget?: AgentProfileBindingTarget;
	onClose: () => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	onSaved?: () => void;
	organizationId: string;
	preparing?: { failed: boolean; onRetry: () => void };
	profileId: string;
	renderSavedFolders: () => ReactNode;
	saveBlockedReason?: string;
	storageScope: string;
	target?: PeopleComputerTarget;
};

type FolderFlowPlan =
	| { kind: "loading" }
	| { kind: "blocked"; message: string }
	| {
			kind: "ready";
			binding: AgentProfileBindingTarget;
			target: PeopleComputerTarget;
	  };

type FolderFlowState =
	| { kind: "idle" }
	| { kind: "picking" }
	| { kind: "error"; message: string }
	| { kind: "finish_default"; message: string };

const PICKER_TIMEOUT_MS = 610_000;
const PARTIAL_SAVE_MESSAGE =
	"The folder was saved, but OpenMeld couldn’t clear the default Project. Try finishing the change.";

class FolderDefaultIncomplete extends Error {}

export function AgentProfileDirectFolderFlow(input: DirectFolderFlowInput) {
	const queryClient = useQueryClient();
	const [state, setState] = useState<FolderFlowState>({ kind: "idle" });
	const [advanced, setAdvanced] = useState(false);
	const started = useRef(false);
	const mounted = useRef(false);
	const latest = useRef(input);
	latest.current = input;
	const frozen = useRef<Extract<FolderFlowPlan, { kind: "ready" }> | null>(
		null
	);
	const plan = resolveFolderFlowPlan(input);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const apply = async (
		targetPlan: Extract<FolderFlowPlan, { kind: "ready" }>,
		path: string
	) => {
		const snapshot = latest.current;
		const result = await saveSelectedAgentFolder({
			actorProfileId: snapshot.actorProfileId,
			expectedBindingTarget: targetPlan.binding,
			organizationId: snapshot.organizationId,
			path,
			profileId: snapshot.profileId,
		});
		const { queryKey } = agentProfileFoldersQueryOptions({
			enabled: false,
			organizationId: snapshot.organizationId,
			profileId: snapshot.profileId,
			storageScope: snapshot.storageScope,
		});
		await queryClient.cancelQueries({ queryKey });
		const current: GetAgentProfileFoldersResponse = {
			agentProfileId: result.agentProfileId,
			observedAtMs: result.observedAtMs,
			projection: result.projection,
			status: "current",
			target: result.target,
		};
		queryClient.setQueryData<GetAgentProfileFoldersResponse>(
			queryKey,
			(cached) =>
				cached?.status === "current" &&
				cached.projection.revision > current.projection.revision
					? cached
					: current
		);
		await finishDefault(targetPlan);
	};

	const finishDefault = async (
		targetPlan: Extract<FolderFlowPlan, { kind: "ready" }>
	) => {
		const snapshot = latest.current;
		try {
			ensureUnchangedPlan(targetPlan, resolveFolderFlowPlan(snapshot));
			const updated = await updateAgentProfileDefaultProject({
				actorProfileId: snapshot.actorProfileId,
				defaultProjectId: null,
				expectedBindingTarget: targetPlan.binding,
				organizationId: snapshot.organizationId,
				profileId: snapshot.profileId,
			});
			snapshot.onProfileUpdated(updated);
		} catch {
			throw new FolderDefaultIncomplete(PARTIAL_SAVE_MESSAGE);
		}
		clearPendingAgentProfileCreationLocalSetupForProfile(snapshot.profileId);
		await queryClient.invalidateQueries({
			queryKey: [
				"private-working-folder",
				snapshot.storageScope,
				snapshot.organizationId,
				snapshot.profileId,
			],
		});
		if (snapshot.onSaved) {
			snapshot.onSaved();
		} else {
			toast.success("Folder saved.");
		}
		if (mounted.current) {
			snapshot.onClose();
		}
	};

	const handleError = (error: unknown) => {
		if (!mounted.current) {
			return;
		}
		setState({
			kind:
				error instanceof FolderDefaultIncomplete ? "finish_default" : "error",
			message:
				toStructuredApiClientFailure(error).message ||
				"Couldn’t use this folder. Try again.",
		});
	};

	const pick = async (
		targetPlan: Extract<FolderFlowPlan, { kind: "ready" }>
	) => {
		setState({ kind: "picking" });
		frozen.current = targetPlan;
		try {
			await requireLocalDesktopMatch(targetPlan.target);
			if (!mounted.current) {
				return;
			}
			ensureUnchangedPlan(targetPlan, resolveFolderFlowPlan(latest.current));
			const result = await selectPeopleComputerFolders({
				...targetPlan.target,
				allowMultiple: false,
				purpose: "agent_profile_working_folder",
				timeoutMs: PICKER_TIMEOUT_MS,
			});
			if (!mounted.current) {
				return;
			}
			if (result.status === "cancelled") {
				latest.current.onClose();
				return;
			}
			if (result.status === "unavailable") {
				throw new Error(pickerErrorMessage(result));
			}
			ensureUnchangedPlan(targetPlan, resolveFolderFlowPlan(latest.current));
			const [path] = result.paths;
			if (result.deviceId !== targetPlan.target.deviceId) {
				throw new Error(
					"The folder picker answered from a different computer. No folder change was saved."
				);
			}
			if (!path?.trim()) {
				throw new Error("No folder was selected. Try again.");
			}
			await apply(targetPlan, path);
		} catch (error) {
			handleError(error);
		}
	};

	const startPicking = useEffectEvent(pick);
	useEffect(() => {
		if (started.current || advanced || plan.kind !== "ready") {
			return;
		}
		started.current = true;
		startPicking(plan).catch(() => undefined);
	}, [advanced, plan]);

	if (advanced) {
		return input.renderSavedFolders();
	}

	const fallback = resolveFolderFallback(plan, state);
	if (!fallback) {
		return null;
	}

	return (
		<Dialog onOpenChange={(open) => !open && input.onClose()} open>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Folder</DialogTitle>
					<DialogDescription>{fallback}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button onClick={() => setAdvanced(true)} size="sm" variant="ghost">
						Saved folders
					</Button>
					<Button
						disabled={!input.preparing?.failed && plan.kind !== "ready"}
						onClick={() => {
							if (input.preparing?.failed) {
								input.preparing.onRetry();
							} else if (plan.kind === "ready") {
								if (state.kind === "finish_default" && frozen.current) {
									try {
										ensureUnchangedPlan(frozen.current, plan);
									} catch {
										handleError(
											new FolderDefaultIncomplete(PARTIAL_SAVE_MESSAGE)
										);
										return;
									}
									setState({ kind: "picking" });
									finishDefault(plan).catch(handleError);
								} else {
									pick(plan).catch(handleError);
								}
							}
						}}
						size="sm"
					>
						{state.kind === "finish_default" ? "Finish save" : "Try again"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

async function saveSelectedAgentFolder({
	path,
	...scope
}: Omit<Parameters<typeof manageAgentProfileFolders>[0], "operation"> & {
	path: string;
}) {
	try {
		return await manageAgentProfileFolders({
			...scope,
			operation: { folder: { kind: "custom", path }, operation: "repair" },
		});
	} catch (error) {
		const failure = toStructuredApiClientFailure(error);
		const unsupported = "local_agent_control.unsupported";
		if (failure.upstreamCode !== unsupported) {
			throw error;
		}
	}
	// Older Services support adding and selecting a folder separately. Never
	// attempt this after an ambiguous failure; they also refuse corrupt lists.
	const added = await manageAgentProfileFolders({
		...scope,
		operation: { operation: "add_custom", path },
	});
	if (!added.folderId) {
		throw new Error("Couldn’t confirm the new folder. Try again.");
	}
	try {
		return await manageAgentProfileFolders({
			...scope,
			operation: { folderId: added.folderId, operation: "set_default" },
		});
	} catch {
		throw new Error(
			"The folder was added, but it isn’t the default yet. Try again."
		);
	}
}

function resolveFolderFallback(
	plan: FolderFlowPlan,
	state: FolderFlowState
): string | null {
	if (state.kind === "error" || state.kind === "finish_default") {
		return state.message;
	}
	return plan.kind === "blocked" && state.kind !== "picking"
		? plan.message
		: null;
}

function resolveFolderFlowPlan(input: DirectFolderFlowInput): FolderFlowPlan {
	if (input.preparing) {
		if (!input.preparing.failed) {
			return { kind: "loading" };
		}
		return {
			kind: "blocked",
			message: "Couldn’t confirm this Agent’s computer.",
		};
	}
	if (input.saveBlockedReason) {
		return { kind: "blocked", message: input.saveBlockedReason };
	}
	if (input.eligibility === "blocked") {
		return {
			kind: "blocked",
			message: "This Agent is working. Try again after it finishes.",
		};
	}
	if (
		!(input.expectedBindingTarget && input.target) ||
		input.eligibility !== "allowed"
	) {
		return {
			kind: "blocked",
			message: "Couldn’t confirm this Agent’s computer or availability.",
		};
	}
	return {
		kind: "ready",
		binding: input.expectedBindingTarget,
		target: input.target,
	};
}

function ensureUnchangedPlan(
	selected: Extract<FolderFlowPlan, { kind: "ready" }>,
	current: FolderFlowPlan
) {
	if (
		current.kind !== "ready" ||
		selected.target.deviceId !== current.target.deviceId ||
		selected.target.runtimeLane !== current.target.runtimeLane ||
		selected.binding.bindingId !== current.binding.bindingId ||
		selected.binding.openMeldServiceRuntimeId !==
			current.binding.openMeldServiceRuntimeId ||
		selected.binding.agentControllerRef !==
			current.binding.agentControllerRef ||
		selected.binding.agentControllerConversationId !==
			current.binding.agentControllerConversationId
	) {
		throw new Error(
			"This Agent’s computer or availability changed. No folder change was saved."
		);
	}
}

async function requireLocalDesktopMatch(target: PeopleComputerTarget) {
	const desktop = getDesktopPlatform();
	if (!desktop) {
		return;
	}
	const local = desktopLocalComputerSchema.parse(await desktop.localComputer());
	if (local.status !== "available") {
		throw new Error(local.message);
	}
	if (
		local.target.deviceId !== target.deviceId ||
		local.target.runtimeLane !== target.runtimeLane
	) {
		throw new Error(
			"This Agent runs elsewhere. Use OpenMeld on its computer to choose a folder."
		);
	}
}

function pickerErrorMessage(
	result: Extract<LocalFolderPickerResult, { status: "unavailable" }>
): string {
	switch (result.code) {
		case "local.folder_picker.no_interactive_session":
			return "Sign in to this computer, then try again.";
		case "local.folder_picker.service_offline":
			return "This computer is offline.";
		case "local.folder_picker.picker_busy":
			return "Close the folder picker already open on this computer, then try again.";
		default:
			return "Couldn’t open the folder picker on this computer.";
	}
}
