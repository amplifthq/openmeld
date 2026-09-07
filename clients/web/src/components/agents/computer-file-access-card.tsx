"use client";

import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { computerFileAccessAbsolutePathSchema } from "@openmeld/schemas";
import type {
	ComputerFileAccessMode,
	ComputerFileAccessPolicyInput,
	ComputerFileAccessPolicyResponse,
	DaemonServiceLane,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import {
	FolderSimpleIcon,
	InfoIcon,
	PlusIcon,
	ShieldCheckIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { LocalFolderPickerButton } from "#/components/local-runtimes/local-folder-picker-button";
import { updateComputerFileAccessPolicy } from "#/lib/connect/computer-file-access";
import {
	computerFileAccessPolicyQueryOptions,
	computerFileAccessQueryKeys,
} from "#/query/connect/computer-file-access";
import { ComputerFileAccessProjectPicker } from "./computer-file-access-project-picker";

const FILE_ACCESS_OPTIONS: readonly {
	description: string;
	label: string;
	value: ComputerFileAccessMode;
}[] = [
	{
		description: "OpenMeld won’t add another file boundary.",
		label: "Use each local agent’s settings",
		value: "local_agent_settings",
	},
	{
		description: "OpenMeld runs can access only these folders.",
		label: "Only selected folders",
		value: "only_selected_folders",
	},
	{
		description: "OpenMeld runs can access other folders, but not these.",
		label: "Block selected folders",
		value: "block_selected_folders",
	},
];

const FULL_PATH_ERROR = "Enter the full folder path on this computer.";

type FolderDraft = {
	id: string;
	path: string;
};

type FileAccessDraft = {
	folders: FolderDraft[];
	mode: ComputerFileAccessMode;
};

type FileAccessDraftAction =
	| { mode: ComputerFileAccessMode; type: "set_mode" }
	| { folders: FolderDraft[]; type: "set_folders" }
	| {
			policy: ComputerFileAccessPolicyResponse["policy"];
			type: "replace_policy";
	  };

export function ComputerFileAccessCard(input: {
	canChooseFolders: boolean;
	canChooseProjects: boolean;
	deviceId: string;
	runtimeLane: DaemonServiceLane;
	focusFileAccess?: boolean;
	onFocusConsumed?: () => void;
	storageScope: string;
}) {
	const cardRef = useRef<HTMLDivElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const policyQuery = useQuery(
		computerFileAccessPolicyQueryOptions({
			deviceId: input.deviceId,
			runtimeLane: input.runtimeLane,
			storageScope: input.storageScope,
		})
	);

	useEffect(() => {
		if (!(input.focusFileAccess && cardRef.current && headingRef.current)) {
			return;
		}

		cardRef.current.scrollIntoView({ block: "center" });
		headingRef.current.focus({ preventScroll: true });
		input.onFocusConsumed?.();
	}, [input.focusFileAccess, input.onFocusConsumed]);

	return (
		<Card id="computer-file-access" ref={cardRef}>
			<CardHeader>
				<CardTitle>
					<h2
						className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
						ref={headingRef}
						tabIndex={-1}
					>
						<ShieldCheckIcon aria-hidden="true" className="size-5" />
						File access
					</h2>
				</CardTitle>
				<CardDescription>
					Choose which folders OpenMeld runs can access on this computer.
				</CardDescription>
			</CardHeader>

			{policyQuery.isPending ? (
				<CardContent>
					<FileAccessLoading />
				</CardContent>
			) : null}
			{policyQuery.isError ? (
				<CardContent>
					<FileAccessReadError
						error={policyQuery.error}
						onRetry={() => policyQuery.refetch()}
					/>
				</CardContent>
			) : null}
			{policyQuery.isSuccess ? (
				<FileAccessEditor
					canChooseFolders={input.canChooseFolders}
					canChooseProjects={input.canChooseProjects}
					deviceId={input.deviceId}
					policyResponse={policyQuery.data}
					runtimeLane={input.runtimeLane}
					storageScope={input.storageScope}
				/>
			) : null}
		</Card>
	);
}

function FileAccessEditor(input: {
	canChooseFolders: boolean;
	canChooseProjects: boolean;
	deviceId: string;
	runtimeLane: DaemonServiceLane;
	policyResponse: ComputerFileAccessPolicyResponse;
	storageScope: string;
}) {
	const queryClient = useQueryClient();
	const [draft, dispatchDraft] = useReducer(
		fileAccessDraftReducer,
		input.policyResponse.policy,
		createFileAccessDraft
	);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [projectPickerOpen, setProjectPickerOpen] = useState(false);
	const [saved, setSaved] = useState(false);
	const folderPaths = useMemo(
		() => draft.folders.map((folder) => folder.path),
		[draft.folders]
	);
	const canonicalDraft = useMemo(
		() => buildCanonicalDraft({ folders: folderPaths, mode: draft.mode }),
		[draft.mode, folderPaths]
	);
	const hasChanges = !policiesMatch(
		canonicalDraft,
		input.policyResponse.policy
	);
	const selectedIndex = FILE_ACCESS_OPTIONS.findIndex(
		(option) => option.value === draft.mode
	);
	const mutation = useMutation<
		ComputerFileAccessPolicyResponse,
		StructuredApiClientFailure,
		ComputerFileAccessPolicyInput
	>({
		mutationFn: (policy) =>
			updateComputerFileAccessPolicy({
				deviceId: input.deviceId,
				runtimeLane: input.runtimeLane,
				expectedRevision: input.policyResponse.policy.revision,
				idempotencyKey: crypto.randomUUID(),
				policy,
			}),
		onSuccess: (response) => {
			queryClient.setQueryData(
				computerFileAccessQueryKeys.policy(
					input.storageScope,
					input.deviceId,
					input.runtimeLane
				),
				response
			);
			dispatchDraft({ policy: response.policy, type: "replace_policy" });
			setValidationError(null);
			setSaved(true);
		},
	});

	const resetFeedback = () => {
		setSaved(false);
		setValidationError(null);
		mutation.reset();
	};
	const selectMode = (nextMode: ComputerFileAccessMode) => {
		dispatchDraft({ mode: nextMode, type: "set_mode" });
		resetFeedback();
	};
	const submit = () => {
		const parsed = validateDraft(canonicalDraft);
		if (!parsed.success) {
			setValidationError(parsed.message);
			return;
		}
		setValidationError(null);
		mutation.mutate(parsed.policy);
	};

	return (
		<>
			<CardContent className="space-y-5">
				<div className="border-border/70 border-l-2 pl-3 text-muted-foreground text-xs/relaxed">
					This applies only to runs started by OpenMeld. Your direct use of
					local agents is unchanged.
				</div>

				<RadioGroup
					aria-disabled={mutation.isPending || undefined}
					aria-label="OpenMeld run file access"
					className="w-full gap-1"
					selectedIndex={selectedIndex}
				>
					{FILE_ACCESS_OPTIONS.map((option, index) => (
						<RadioItem
							className="px-3 py-2.5"
							description={option.description}
							index={index}
							key={option.value}
							label={option.label}
							onSelect={() => {
								if (!mutation.isPending) {
									selectMode(option.value);
								}
							}}
							selected={draft.mode === option.value}
						/>
					))}
				</RadioGroup>

				{draft.mode === "local_agent_settings" ? null : (
					<FolderEditor
						canChooseFolders={input.canChooseFolders}
						canChooseProjects={input.canChooseProjects}
						deviceId={input.deviceId}
						disabled={mutation.isPending}
						folders={draft.folders}
						onChange={(nextFolders) => {
							dispatchDraft({
								folders: nextFolders,
								type: "set_folders",
							});
							resetFeedback();
						}}
						onChooseProjects={() => setProjectPickerOpen(true)}
						runtimeLane={input.runtimeLane}
					/>
				)}

				<div className="flex gap-2 text-muted-foreground text-xs/relaxed">
					<InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
					<p>
						If OpenMeld can’t verify this boundary for a local agent, it will
						pause only that run and ask you.
					</p>
				</div>

				{validationError ? (
					<p className="text-destructive text-xs/relaxed" role="alert">
						{validationError}
					</p>
				) : null}
				{mutation.isError ? (
					<p className="text-destructive text-xs/relaxed" role="alert">
						{formatFileAccessError(mutation.error)}
					</p>
				) : null}
			</CardContent>

			<CardFooter className="justify-end">
				<Button
					disabled={!hasChanges || mutation.isPending}
					onClick={submit}
					type="button"
				>
					{resolveSaveLabel({
						hasChanges,
						isPending: mutation.isPending,
						saved,
					})}
				</Button>
			</CardFooter>

			<ComputerFileAccessProjectPicker
				currentFolders={folderPaths}
				disabled={mutation.isPending}
				onAddFolders={(projectFolders) => {
					dispatchDraft({
						folders: mergeUniqueFolderDrafts(draft.folders, projectFolders),
						type: "set_folders",
					});
					resetFeedback();
				}}
				onOpenChange={setProjectPickerOpen}
				open={projectPickerOpen}
			/>
		</>
	);
}

function FolderEditor(input: {
	canChooseFolders: boolean;
	canChooseProjects: boolean;
	deviceId: string;
	runtimeLane: DaemonServiceLane;
	disabled: boolean;
	folders: readonly FolderDraft[];
	onChange: (folders: FolderDraft[]) => void;
	onChooseProjects: () => void;
}) {
	return (
		<fieldset className="space-y-2">
			<legend className="font-medium text-xs">Folders on this computer</legend>
			{input.folders.length === 0 ? (
				<p className="text-muted-foreground text-xs/relaxed">
					Choose folders directly on this computer. You can also add known
					Project folders or enter a path manually.
				</p>
			) : null}
			<div className="space-y-2">
				{input.folders.map((folder, index) => (
					<div className="flex items-center gap-2" key={folder.id}>
						<FolderSimpleIcon
							aria-hidden="true"
							className="size-4 shrink-0 text-muted-foreground"
						/>
						<Input
							aria-label={`Folder ${index + 1}`}
							autoCapitalize="none"
							autoComplete="off"
							className="font-mono"
							disabled={input.disabled}
							onChange={(event) => {
								input.onChange(
									input.folders.map((currentFolder) =>
										currentFolder.id === folder.id
											? { ...currentFolder, path: event.target.value }
											: currentFolder
									)
								);
							}}
							placeholder="/Users/name/folder"
							spellCheck={false}
							value={folder.path}
						/>
						{input.folders.length > 1 ? (
							<Button
								aria-label={`Remove folder ${index + 1}`}
								disabled={input.disabled}
								onClick={() => {
									input.onChange(
										input.folders.filter(
											(currentFolder) => currentFolder.id !== folder.id
										)
									);
								}}
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<XIcon aria-hidden="true" />
							</Button>
						) : null}
					</div>
				))}
			</div>
			<div className="flex flex-wrap gap-2">
				{input.canChooseFolders ? (
					<LocalFolderPickerButton
						allowMultiple
						deviceId={input.deviceId}
						disabled={input.disabled || input.folders.length >= 128}
						label="Choose folders on this computer"
						onSelect={(paths) =>
							input.onChange(mergeUniqueFolderDrafts(input.folders, paths))
						}
						purpose="computer_file_access"
						runtimeLane={input.runtimeLane}
					/>
				) : null}
				{input.canChooseProjects ? (
					<Button
						disabled={input.disabled || input.folders.length >= 128}
						onClick={input.onChooseProjects}
						size="sm"
						type="button"
						variant={input.canChooseFolders ? "ghost" : "outline"}
					>
						<FolderSimpleIcon aria-hidden="true" data-icon="inline-start" />
						Add from Projects
					</Button>
				) : null}
				<Button
					disabled={input.disabled || input.folders.length >= 128}
					onClick={() =>
						input.onChange([...input.folders, createFolderDraft("")])
					}
					size="sm"
					type="button"
					variant="ghost"
				>
					<PlusIcon aria-hidden="true" data-icon="inline-start" />
					{input.folders.length === 0
						? "Enter a folder path"
						: "Enter another folder path"}
				</Button>
			</div>
		</fieldset>
	);
}

function createFolderDraft(path: string): FolderDraft {
	return { id: crypto.randomUUID(), path };
}

function createFileAccessDraft(
	policy: ComputerFileAccessPolicyResponse["policy"]
): FileAccessDraft {
	return {
		folders:
			policy.mode === "local_agent_settings"
				? []
				: policy.folders.map(createFolderDraft),
		mode: policy.mode,
	};
}

function fileAccessDraftReducer(
	draft: FileAccessDraft,
	action: FileAccessDraftAction
): FileAccessDraft {
	if (action.type === "set_mode") {
		return { ...draft, mode: action.mode };
	}
	if (action.type === "set_folders") {
		return { ...draft, folders: action.folders };
	}
	return createFileAccessDraft(action.policy);
}

function mergeUniqueFolderDrafts(
	currentFolders: readonly FolderDraft[],
	addedFolders: readonly string[]
): FolderDraft[] {
	const existingPaths = new Set(currentFolders.map((folder) => folder.path));
	const uniqueAddedFolders = addedFolders.filter((folder) => {
		if (existingPaths.has(folder)) {
			return false;
		}
		existingPaths.add(folder);
		return true;
	});
	return [
		...currentFolders,
		...uniqueAddedFolders.map(createFolderDraft),
	].slice(0, 128);
}

function FileAccessLoading() {
	return (
		<output aria-label="Loading file access settings" className="grid gap-2">
			<Skeleton className="h-16 w-full" />
			<Skeleton className="h-16 w-full" />
			<Skeleton className="h-16 w-full" />
		</output>
	);
}

function FileAccessReadError(input: {
	error: StructuredApiClientFailure;
	onRetry: () => void;
}) {
	return (
		<div className="space-y-3">
			<p className="text-destructive text-xs/relaxed" role="alert">
				{formatFileAccessError(input.error)}
			</p>
			<Button onClick={input.onRetry} size="sm" type="button" variant="outline">
				Try again
			</Button>
		</div>
	);
}

function buildCanonicalDraft(input: {
	folders: readonly string[];
	mode: ComputerFileAccessMode;
}): ComputerFileAccessPolicyInput {
	if (input.mode === "local_agent_settings") {
		return { mode: input.mode };
	}
	return {
		folders: [...input.folders],
		mode: input.mode,
	};
}

function validateDraft(
	policy: ComputerFileAccessPolicyInput
):
	| { policy: ComputerFileAccessPolicyInput; success: true }
	| { message: string; success: false } {
	if (policy.mode === "local_agent_settings") {
		return { policy, success: true };
	}
	if (policy.folders.length === 0) {
		return { message: "Add at least one folder.", success: false };
	}
	for (const folder of policy.folders) {
		if (folder.trim().length === 0) {
			return { message: FULL_PATH_ERROR, success: false };
		}
		if (!computerFileAccessAbsolutePathSchema.safeParse(folder).success) {
			return { message: FULL_PATH_ERROR, success: false };
		}
	}
	return { policy, success: true };
}

function policiesMatch(
	draft: ComputerFileAccessPolicyInput,
	saved: ComputerFileAccessPolicyResponse["policy"]
): boolean {
	if (draft.mode !== saved.mode) {
		return false;
	}
	if (draft.mode === "local_agent_settings") {
		return true;
	}
	if (saved.mode === "local_agent_settings") {
		return false;
	}
	return (
		draft.folders.length === saved.folders.length &&
		draft.folders.every((folder, index) => folder === saved.folders[index])
	);
}

function formatFileAccessError(error: StructuredApiClientFailure): string {
	switch (error.upstreamCode) {
		case "computer.file_access.path_not_found":
			return "OpenMeld couldn’t find that folder on this computer.";
		case "computer.file_access.path_not_directory":
			return "Choose a folder, not a file.";
		case "computer.file_access.path_unreadable":
			return "OpenMeld Service can’t read that folder.";
		case "computer.file_access.device_mismatch":
			return "Open this Computer from the same computer to change file access.";
		case "computer.file_access.service_update_required":
		case "computer.file_access.unsupported":
			return "Update OpenMeld Service on this computer, then try again.";
		case "computer.file_access.service_offline":
			return "OpenMeld Service is offline on this computer.";
		case "computer.file_access.timeout":
			return "OpenMeld Service didn’t respond. Try again.";
		default:
			return error.message || "OpenMeld couldn’t update file access.";
	}
}

function resolveSaveLabel(input: {
	hasChanges: boolean;
	isPending: boolean;
	saved: boolean;
}): string {
	if (input.isPending) {
		return "Saving…";
	}
	if (input.saved && !input.hasChanges) {
		return "Saved";
	}
	return "Save";
}
