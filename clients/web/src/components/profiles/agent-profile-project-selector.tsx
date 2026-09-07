"use client";

import type {
	LocalProjectControlCandidate,
	LocalProjectControlConnection,
	LocalProjectControlConnectResponse,
	LocalProjectControlPathConflictResponse,
	Project,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useEffect, useRef, useState } from "react";
import { LocalFolderPickerButton } from "#/components/local-runtimes/local-folder-picker-button";
import { SelectedLocalFolder } from "#/components/local-runtimes/selected-local-folder";
import { FolderMoveConfirmationDialog } from "#/components/projects/folder-move-confirmation-dialog";
import type { ProjectComputerView } from "#/components/projects/use-project-discovery";
import { useProjectDiscovery } from "#/components/projects/use-project-discovery";
import { resolveLocalFolderPickerDeviceId } from "#/lib/connect/local-folder-picker";
import {
	connectCurrentComputerProjectCandidate,
	connectCurrentComputerProjectPath,
	isLocalProjectControlFailureCode,
	resolveLocalProjectControlErrorMessage,
	setCurrentComputerProjectDefaultConnection,
} from "#/lib/organizations/local-project-control";
import {
	type AgentProfileProjectSelectorBranch,
	resolveAgentProfileProjectCandidate,
	resolveAgentProfileProjectSelectorBranch,
} from "./agent-profile-project-selector-state";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const OPENMELD_MANAGED_FOLDER_VALUE = "openmeld-managed";
const CUSTOM_FOLDER_VALUE = "custom-folder";

type PendingFolderMove =
	| {
			candidate: LocalProjectControlCandidate;
			conflict: LocalProjectControlPathConflictResponse;
			kind: "candidate";
	  }
	| {
			confirmNonGit: boolean;
			conflict: LocalProjectControlPathConflictResponse;
			kind: "declared_path";
	  };

export function AgentProfileProjectSelector(input: {
	autoSelectSingleConnection?: boolean;
	disabled: boolean;
	manualPath: string;
	onConnectionReady: (connection: LocalProjectControlConnection) => void;
	onManualPathChange: (path: string) => void;
	onProjectChange: (projectId: string) => void;
	onUseAdvancedWorkspace?: () => void;
	onUseManagedWorkspace?: () => void;
	organizationId: string;
	projectId: string;
	projects: readonly Project[];
	selectedBindingGeneration: string | null;
	showWorkspaceFallbacks?: boolean;
	showProjectSelector?: boolean;
	workspaceFallbackMode?: "advanced" | "managed" | null;
}) {
	const controller = useProjectDiscovery({
		organizationId: input.organizationId,
		projects: input.projects,
	});
	const view = input.projectId ? controller.projectView(input.projectId) : null;
	const projectOptions = input.projects.map((project) => ({
		path: resolveProjectDefaultPath(controller.projectView(project.id)),
		project,
	}));
	const branch = view
		? resolveAgentProfileProjectSelectorBranch(view)
		: "no_candidate";
	const [declaredPath, setDeclaredPath] = useState("");
	const [confirmNonGit, setConfirmNonGit] = useState(false);
	const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
		null
	);
	const [pendingOperation, setPendingOperation] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [pendingFolderMove, setPendingFolderMove] =
		useState<PendingFolderMove | null>(null);
	const automaticSelectionKeyRef = useRef<string | null>(null);
	const onConnectionReady = input.onConnectionReady;
	const selectedProjectName =
		input.projects.find((project) => project.id === input.projectId)?.name ??
		"this Project";
	const pickerDeviceId = resolveLocalFolderPickerDeviceId(controller.computer);

	useEffect(() => {
		if (
			input.autoSelectSingleConnection === false ||
			!view ||
			branch !== "connected" ||
			input.selectedBindingGeneration
		) {
			return;
		}
		const connection = view.connections.find(
			(candidate) => candidate.status === "available" && candidate.isDefault
		);
		if (!connection) {
			return;
		}
		const key = `${input.projectId}:${connection.bindingGeneration}`;
		if (automaticSelectionKeyRef.current === key) {
			return;
		}
		automaticSelectionKeyRef.current = key;
		onConnectionReady(connection);
	}, [
		branch,
		input.autoSelectSingleConnection,
		input.projectId,
		input.selectedBindingGeneration,
		onConnectionReady,
		view,
	]);

	const promoteConnectionToDefault = async (
		connection: LocalProjectControlConnection,
		unavailableMessage: string
	): Promise<LocalProjectControlConnection> => {
		const response = await setCurrentComputerProjectDefaultConnection({
			clientGeneration: controller.claimMutationGeneration(),
			expectedOrganizationId: input.organizationId,
			idempotencyKey: crypto.randomUUID(),
			projectId: input.projectId,
			targetBindingGeneration: connection.bindingGeneration,
		});
		controller.applyConnectionSnapshot(input.projectId, response.connections);
		const selected = response.connections.find(
			(candidate) =>
				candidate.bindingGeneration === connection.bindingGeneration
		);
		if (!selected) {
			throw new Error(unavailableMessage);
		}
		return selected;
	};

	const selectConnection = async (
		connection: LocalProjectControlConnection
	) => {
		if (connection.status !== "available") {
			return;
		}
		if (connection.isDefault) {
			input.onConnectionReady(connection);
			return;
		}
		setPendingOperation(`default:${connection.bindingGeneration}`);
		setErrorMessage(null);
		try {
			const selected = await promoteConnectionToDefault(
				connection,
				"The selected Project folder is no longer connected."
			);
			input.onConnectionReady(selected);
		} catch (error) {
			setErrorMessage(resolveLocalProjectControlErrorMessage(error));
		}
		setPendingOperation(null);
	};

	const selectConnectedPath = async (
		response: LocalProjectControlConnectResponse
	) => {
		const connection: LocalProjectControlConnection = {
			bindingGeneration: response.bindingGeneration,
			isDefault: response.isDefault,
			path: response.canonicalPath,
			status: "available",
		};
		if (connection.isDefault) {
			controller.refresh();
			input.onConnectionReady(connection);
			return;
		}
		const selected = await promoteConnectionToDefault(
			connection,
			"The connected Project folder is no longer available."
		);
		input.onConnectionReady(selected);
	};

	const connectCandidate = async (candidateRequest?: {
		candidate: LocalProjectControlCandidate;
		moveConfirmationToken?: string;
	}): Promise<void> => {
		const candidate =
			candidateRequest?.candidate ??
			resolveAgentProfileProjectCandidate(
				view?.discovery?.candidates ?? [],
				selectedCandidateId
			);
		if (!candidate) {
			setErrorMessage("Choose the Project folder to connect.");
			return;
		}
		setPendingOperation("candidate");
		setErrorMessage(null);
		try {
			const response = await connectCurrentComputerProjectCandidate({
				candidateId: candidate.candidateId,
				candidatePath: candidate.canonicalPath,
				clientGeneration: controller.claimMutationGeneration(),
				expectedOrganizationId: input.organizationId,
				idempotencyKey: crypto.randomUUID(),
				...(candidateRequest?.moveConfirmationToken
					? {
							moveConfirmationToken: candidateRequest.moveConfirmationToken,
						}
					: {}),
				projectId: input.projectId,
			});
			if (response.status === "rejected") {
				setPendingFolderMove({
					candidate,
					conflict: response,
					kind: "candidate",
				});
			} else {
				await selectConnectedPath(response);
				setPendingFolderMove(null);
			}
		} catch (error) {
			if (
				candidateRequest?.moveConfirmationToken &&
				isLocalProjectControlFailureCode(error, "binding_generation_stale")
			) {
				setPendingFolderMove(null);
				setPendingOperation(null);
				await connectCandidate({ candidate });
				return;
			}
			setErrorMessage(resolveLocalProjectControlErrorMessage(error));
		}
		setPendingOperation(null);
	};

	const connectDeclaredPath = async (
		confirm: boolean,
		moveConfirmationToken?: string
	): Promise<void> => {
		const path = declaredPath;
		if (path.trim().length === 0 || !isAbsoluteProjectPath(path)) {
			setErrorMessage("Enter the full folder path on this computer.");
			return;
		}
		setPendingOperation("path");
		setErrorMessage(null);
		try {
			const response = await connectCurrentComputerProjectPath({
				clientGeneration: controller.claimMutationGeneration(),
				...(confirm ? { confirmNonGit: true } : {}),
				declaredPath: path,
				expectedOrganizationId: input.organizationId,
				idempotencyKey: crypto.randomUUID(),
				...(moveConfirmationToken ? { moveConfirmationToken } : {}),
				projectId: input.projectId,
			});
			if (response.status === "rejected") {
				setConfirmNonGit(false);
				setPendingFolderMove({
					confirmNonGit: confirm,
					conflict: response,
					kind: "declared_path",
				});
			} else {
				await selectConnectedPath(response);
				setConfirmNonGit(false);
				setDeclaredPath("");
				setPendingFolderMove(null);
			}
		} catch (error) {
			if (isLocalProjectControlFailureCode(error, "needs_confirmation")) {
				setConfirmNonGit(true);
			} else if (
				moveConfirmationToken &&
				isLocalProjectControlFailureCode(error, "binding_generation_stale")
			) {
				setPendingFolderMove(null);
				setPendingOperation(null);
				await connectDeclaredPath(confirm);
				return;
			} else {
				setErrorMessage(resolveLocalProjectControlErrorMessage(error));
			}
		}
		setPendingOperation(null);
	};

	return (
		<section
			className="grid min-w-0 gap-3"
			data-testid="agent-profile-project-selector"
		>
			{input.showProjectSelector === false ? null : (
				<div className="grid min-w-0 gap-2">
					<Label htmlFor="agent-profile-project-select">Working folder</Label>
					<Select
						disabled={input.disabled}
						onValueChange={(value) => {
							if (value === OPENMELD_MANAGED_FOLDER_VALUE) {
								input.onProjectChange("");
								input.onUseManagedWorkspace?.();
							} else if (value === CUSTOM_FOLDER_VALUE) {
								input.onProjectChange("");
								input.onUseAdvancedWorkspace?.();
							} else {
								input.onProjectChange(value ?? "");
							}
							setErrorMessage(null);
							setDeclaredPath("");
							setConfirmNonGit(false);
							setPendingFolderMove(null);
							setSelectedCandidateId(null);
						}}
						value={
							input.projectId ||
							(input.workspaceFallbackMode === "advanced"
								? CUSTOM_FOLDER_VALUE
								: OPENMELD_MANAGED_FOLDER_VALUE)
						}
					>
						<SelectTrigger
							className="h-10 w-full min-w-0 px-3 text-sm"
							displayValue={
								<span
									className="block max-w-full overflow-x-auto whitespace-nowrap [scrollbar-width:thin]"
									data-testid="working-folder-display-value"
								>
									{resolveWorkingFolderDisplayValue({
										manualPath: input.manualPath,
										projectId: input.projectId,
										projectOptions,
										workspaceFallbackMode: input.workspaceFallbackMode,
									})}
								</span>
							}
							id="agent-profile-project-select"
						/>
						<SelectContent className="overflow-x-hidden" matchTriggerWidth>
							{projectOptions.map(({ path, project }, index) => (
								<SelectItem index={index} key={project.id} value={project.id}>
									<span className="flex min-w-0 flex-col gap-0.5">
										<span>{project.name}</span>
										{path ? (
											<span className="max-w-full overflow-x-auto whitespace-nowrap text-muted-foreground [scrollbar-width:thin]">
												{path}
											</span>
										) : null}
									</span>
								</SelectItem>
							))}
							<SelectItem
								index={projectOptions.length}
								value={OPENMELD_MANAGED_FOLDER_VALUE}
							>
								Let OpenMeld choose
							</SelectItem>
							<SelectItem
								index={projectOptions.length + 1}
								value={CUSTOM_FOLDER_VALUE}
							>
								Choose a folder on this computer…
							</SelectItem>
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs leading-5">
						A Project keeps this Agent connected to the same work. You can also
						let OpenMeld choose or use another folder on this computer.
					</p>
				</div>
			)}

			{input.projectId && input.onUseManagedWorkspace ? (
				<Button
					className="justify-self-start"
					disabled={input.disabled}
					onClick={() => {
						input.onProjectChange("");
						input.onUseManagedWorkspace?.();
					}}
					size="sm"
					type="button"
					variant="outline"
				>
					Use OpenMeld managed folder
				</Button>
			) : null}
			{input.projectId && view ? (
				<ProjectSelectionDetails
					branch={branch}
					confirmNonGit={confirmNonGit}
					declaredPath={declaredPath}
					disabled={input.disabled || pendingOperation !== null}
					onConnectCandidate={connectCandidate}
					onConnectPath={connectDeclaredPath}
					onDeclaredPathChange={setDeclaredPath}
					onSelectConnection={selectConnection}
					onSelectedCandidateChange={setSelectedCandidateId}
					pendingOperation={pendingOperation}
					pickerDeviceId={pickerDeviceId}
					selectedBindingGeneration={input.selectedBindingGeneration}
					selectedCandidateId={selectedCandidateId}
					view={view}
				/>
			) : null}
			{input.projectId && view ? (
				<MissingProjectConnections connections={view.connections} />
			) : null}

			<FolderMoveConfirmationDialog
				conflict={pendingFolderMove?.conflict ?? null}
				errorMessage={errorMessage}
				onConfirm={() => {
					if (pendingFolderMove?.kind === "candidate") {
						connectCandidate({
							candidate: pendingFolderMove.candidate,
							moveConfirmationToken:
								pendingFolderMove.conflict.moveConfirmationToken,
						}).catch(() => undefined);
						return;
					}
					if (pendingFolderMove?.kind === "declared_path") {
						connectDeclaredPath(
							pendingFolderMove.confirmNonGit,
							pendingFolderMove.conflict.moveConfirmationToken
						).catch(() => undefined);
					}
				}}
				onOpenChange={(open) => {
					if (!(open || pendingOperation)) {
						setErrorMessage(null);
						setPendingFolderMove(null);
					}
				}}
				open={pendingFolderMove !== null}
				pending={pendingOperation !== null}
				projectName={selectedProjectName}
			/>

			<WorkspaceFallbackControls
				disabled={input.disabled}
				manualPath={input.manualPath}
				onManualPathChange={input.onManualPathChange}
				pickerDeviceId={pickerDeviceId}
				visible={
					input.showWorkspaceFallbacks !== false &&
					(!input.projectId || branch === "no_candidate")
				}
				wasProjectSelected={Boolean(input.projectId)}
				workspaceFallbackMode={input.workspaceFallbackMode}
			/>

			{errorMessage && !pendingFolderMove ? (
				<p className="text-destructive text-xs leading-5">{errorMessage}</p>
			) : null}
		</section>
	);
}

function resolveProjectDefaultPath(view: ProjectComputerView): string | null {
	return (
		view.connections.find(
			(connection) => connection.status === "available" && connection.isDefault
		)?.path ?? null
	);
}

function resolveWorkingFolderDisplayValue(input: {
	manualPath: string;
	projectId: string;
	projectOptions: readonly {
		path: string | null;
		project: Project;
	}[];
	workspaceFallbackMode?: "advanced" | "managed" | null;
}): string {
	if (input.projectId) {
		const selected = input.projectOptions.find(
			(option) => option.project.id === input.projectId
		);
		if (selected) {
			return selected.path
				? `${selected.project.name} — ${selected.path}`
				: selected.project.name;
		}
	}
	if (input.workspaceFallbackMode === "advanced") {
		return input.manualPath || "Folder on this computer";
	}
	return "Let OpenMeld choose";
}

function WorkspaceFallbackControls(input: {
	disabled: boolean;
	manualPath: string;
	onManualPathChange: (path: string) => void;
	pickerDeviceId: string | null;
	visible: boolean;
	wasProjectSelected: boolean;
	workspaceFallbackMode?: "advanced" | "managed" | null;
}) {
	const [manualPathOpen, setManualPathOpen] = useState(false);
	if (!input.visible) {
		return null;
	}
	return (
		<div className="grid min-w-0 gap-3">
			{input.wasProjectSelected ? (
				<p className="text-muted-foreground text-xs leading-5">
					No matching Project folder was found. Choose another folder for this
					profile.
				</p>
			) : null}
			{input.workspaceFallbackMode === "advanced" ? (
				<div className="grid min-w-0 gap-2">
					{input.pickerDeviceId ? (
						<LocalFolderPickerButton
							allowMultiple={false}
							deviceId={input.pickerDeviceId}
							disabled={input.disabled}
							label="Choose folder on this computer"
							onSelect={(paths) => {
								const path = paths[0];
								if (path !== undefined) {
									setManualPathOpen(false);
									input.onManualPathChange(path);
								}
							}}
							purpose="agent_profile_working_folder"
							variant="default"
						/>
					) : null}
					{input.manualPath && !manualPathOpen ? (
						<SelectedLocalFolder path={input.manualPath} />
					) : null}
					{input.pickerDeviceId && !manualPathOpen ? (
						<Button
							className="justify-self-start"
							disabled={input.disabled}
							onClick={() => setManualPathOpen(true)}
							size="sm"
							type="button"
							variant="ghost"
						>
							Enter path manually
						</Button>
					) : null}
					{!input.pickerDeviceId || manualPathOpen ? (
						<div className="grid gap-1.5">
							<Label htmlFor="agent-profile-custom-workspace-path">
								Custom working folder path
							</Label>
							<Input
								disabled={input.disabled}
								id="agent-profile-custom-workspace-path"
								onChange={(event) =>
									input.onManualPathChange(event.target.value)
								}
								placeholder="/full/path/to/folder"
								value={input.manualPath}
							/>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function ProjectSelectionDetails(input: {
	branch: AgentProfileProjectSelectorBranch;
	confirmNonGit: boolean;
	declaredPath: string;
	disabled: boolean;
	onConnectCandidate: () => Promise<void>;
	onConnectPath: (confirm: boolean) => Promise<void>;
	onDeclaredPathChange: (path: string) => void;
	onSelectedCandidateChange: (candidateId: string) => void;
	onSelectConnection: (
		connection: LocalProjectControlConnection
	) => Promise<void>;
	pendingOperation: string | null;
	pickerDeviceId: string | null;
	selectedBindingGeneration: string | null;
	selectedCandidateId: string | null;
	view: ProjectComputerView;
}) {
	const availableConnections = input.view.connections.filter(
		(connection) => connection.status === "available"
	);
	const candidates = input.view.discovery?.candidates ?? [];
	if (input.branch === "connected" || input.branch === "multiple_connections") {
		return (
			<div className="grid min-w-0 gap-2 pt-1">
				<p className="font-medium text-sm">
					{input.branch === "multiple_connections"
						? "Choose the working folder"
						: "Default working folder"}
				</p>
				{availableConnections.map((connection) => (
					<label
						className="flex min-w-0 items-start gap-2 text-sm"
						key={connection.bindingGeneration}
					>
						<input
							checked={
								input.selectedBindingGeneration ===
									connection.bindingGeneration ||
								(!input.selectedBindingGeneration && connection.isDefault)
							}
							disabled={input.disabled}
							onChange={async () => {
								await input.onSelectConnection(connection);
							}}
							type="radio"
						/>
						<span
							className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap [scrollbar-width:thin]"
							data-testid={
								connection.isDefault ? "default-working-folder-path" : undefined
							}
						>
							{connection.path}
							{connection.isDefault ? " (current default)" : ""}
						</span>
					</label>
				))}
			</div>
		);
	}

	return (
		<div className="grid min-w-0 gap-3 pt-1">
			{input.branch === "checking" ? (
				<p className="text-sm">
					OpenMeld is checking known repositories and worktrees on this
					computer. You can connect a folder manually now.
				</p>
			) : null}
			{input.branch === "service_unavailable" ? (
				<p className="text-sm">
					This computer isn't connected to OpenMeld. Reconnect or update it,
					then try again.
				</p>
			) : null}
			{input.branch === "verification_unavailable" ? (
				<p className="text-sm">
					Git could not reliably verify Project folders on this computer.
				</p>
			) : null}
			<ProjectConnectionDraft
				confirmNonGit={input.confirmNonGit}
				disabled={input.disabled}
				onConnectPath={input.onConnectPath}
				onPathChange={input.onDeclaredPathChange}
				path={input.declaredPath}
				pickerDeviceId={input.pickerDeviceId}
			/>
			{input.branch === "candidate" ? (
				<MatchingProjectFolders
					candidates={candidates}
					disabled={input.disabled}
					onConnect={input.onConnectCandidate}
					onSelectedCandidateChange={input.onSelectedCandidateChange}
					pending={input.pendingOperation === "candidate"}
					selectedCandidateId={input.selectedCandidateId}
				/>
			) : null}
		</div>
	);
}

function ProjectConnectionDraft(input: {
	confirmNonGit: boolean;
	disabled: boolean;
	onConnectPath: (confirm: boolean) => Promise<void>;
	onPathChange: (path: string) => void;
	path: string;
	pickerDeviceId: string | null;
}) {
	const [manualPathOpen, setManualPathOpen] = useState(false);
	return (
		<>
			{input.pickerDeviceId ? (
				<LocalFolderPickerButton
					allowMultiple={false}
					deviceId={input.pickerDeviceId}
					disabled={input.disabled}
					label="Choose a Project folder on this computer"
					onSelect={(paths) => {
						const path = paths[0];
						if (path !== undefined) {
							setManualPathOpen(false);
							input.onPathChange(path);
						}
					}}
					purpose="project_connection"
					variant="default"
				/>
			) : null}
			{input.path && !manualPathOpen ? (
				<SelectedLocalFolder path={input.path} />
			) : null}
			{input.pickerDeviceId && !manualPathOpen ? (
				<Button
					className="justify-self-start"
					disabled={input.disabled}
					onClick={() => setManualPathOpen(true)}
					size="sm"
					type="button"
					variant="ghost"
				>
					Enter path manually
				</Button>
			) : null}
			{!input.pickerDeviceId || manualPathOpen ? (
				<div className="grid min-w-0 gap-2">
					<Label htmlFor="agent-profile-connect-folder-input">
						Project folder path
					</Label>
					<Input
						disabled={input.disabled}
						id="agent-profile-connect-folder-input"
						onChange={(event) => input.onPathChange(event.target.value)}
						placeholder="/full/path/to/project"
						value={input.path}
					/>
				</div>
			) : null}
			{input.path ? (
				<Button
					className="justify-self-start"
					disabled={input.disabled}
					onClick={async () => {
						await input.onConnectPath(input.confirmNonGit);
					}}
					type="button"
				>
					{input.confirmNonGit ? "Connect anyway" : "Connect"}
				</Button>
			) : null}
		</>
	);
}

function MatchingProjectFolders(input: {
	candidates: readonly LocalProjectControlCandidate[];
	disabled: boolean;
	onConnect: () => Promise<void>;
	onSelectedCandidateChange: (candidateId: string) => void;
	pending: boolean;
	selectedCandidateId: string | null;
}) {
	return (
		<div className="grid min-w-0 gap-2 border-border/70 border-t pt-3">
			<p className="font-medium text-sm">Matching folders</p>
			<p className="text-muted-foreground text-xs leading-5">
				{input.candidates.length > 1
					? "OpenMeld found matching Project folders. You can use one instead."
					: `OpenMeld found ${input.candidates[0]?.canonicalPath}. You can use it instead.`}
			</p>
			{input.candidates.length > 1 ? (
				<div className="grid min-w-0 gap-2">
					{input.candidates.map((candidate) => (
						<label
							className="flex min-w-0 items-start gap-2 text-sm"
							key={candidate.candidateId}
						>
							<input
								checked={input.selectedCandidateId === candidate.candidateId}
								disabled={input.disabled}
								onChange={() =>
									input.onSelectedCandidateChange(candidate.candidateId)
								}
								type="radio"
							/>
							<span className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap [scrollbar-width:thin]">
								{candidate.canonicalPath}
							</span>
						</label>
					))}
				</div>
			) : null}
			<Button
				className="justify-self-start"
				disabled={
					input.disabled ||
					!resolveAgentProfileProjectCandidate(
						input.candidates,
						input.selectedCandidateId
					)
				}
				onClick={async () => {
					await input.onConnect();
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				{input.pending ? "Connecting..." : "Connect and continue"}
			</Button>
		</div>
	);
}

function MissingProjectConnections(input: {
	connections: readonly LocalProjectControlConnection[];
}) {
	const missingConnections = input.connections.filter(
		(connection) => connection.status === "missing"
	);
	if (missingConnections.length === 0) {
		return null;
	}
	return (
		<div className="grid min-w-0 gap-1 pt-1 text-xs">
			<p className="font-medium">Unavailable on this computer</p>
			{missingConnections.map((connection) => (
				<p
					className="max-w-full overflow-x-auto whitespace-nowrap text-muted-foreground [scrollbar-width:thin]"
					key={connection.bindingGeneration}
				>
					{connection.path}
					{connection.isDefault ? " (current default)" : ""}
				</p>
			))}
		</div>
	);
}

function isAbsoluteProjectPath(value: string): boolean {
	return (
		value.startsWith("/") ||
		value.startsWith("\\\\") ||
		WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
	);
}
