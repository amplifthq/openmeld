"use client";

import { desktopLocalComputerSchema } from "@openmeld/schemas";
import type {
	LocalProjectControlCandidate,
	LocalProjectControlConnection,
	LocalProjectControlConnectResponse,
	LocalProjectControlPathConflictResponse,
	PeopleComputerTarget,
	Project,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { LocalFolderPickerButton } from "#/components/local-runtimes/local-folder-picker-button";
import { SelectedLocalFolder } from "#/components/local-runtimes/selected-local-folder";
import { FolderMoveConfirmationDialog } from "#/components/projects/folder-move-confirmation-dialog";
import { ProjectDefaultFolderDialog } from "#/components/projects/project-default-folder-dialog";
import { ProjectPickerActions } from "#/components/projects/project-picker-actions";
import type { ProjectComputerView } from "#/components/projects/use-project-discovery";
import { useProjectDiscovery } from "#/components/projects/use-project-discovery";
import { WorkingFolderSelect } from "#/components/projects/working-folder-select";
import { getDesktopPlatform } from "#/desktop/platform";
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

type ProjectSelectorInput = {
	target?: PeopleComputerTarget;
	disabled: boolean;
	localFolderChangesBlocked?: boolean;
	/**
	 * Offers only an OpenMeld or custom folder. Repairing folder settings
	 * needs a default folder, which a Project folder can't be.
	 */
	localFoldersOnly?: boolean;
	manualPath: string;
	onConnectionReady: (connection: LocalProjectControlConnection | null) => void;
	onManualPathChange: (path: string) => void;
	onProjectChange: (projectId: string) => void;
	onUseAdvancedWorkspace?: () => void;
	onUseManagedWorkspace?: () => void;
	onUseProjectWorkspace?: () => void;
	organizationId: string;
	projectId: string;
	projects: readonly Project[];
	selectedBindingGeneration: string | null;
	workspaceFallbackMode?: "advanced" | "managed" | "project" | null;
};

export function AgentProfileProjectSelector(input: ProjectSelectorInput) {
	const desktop = getDesktopPlatform();
	const { storageScope } = useStartFlowState();
	const native = useQuery({
		queryKey: [
			"desktop",
			"working-folder-computer",
			storageScope,
			input.organizationId,
		],
		queryFn: async () =>
			desktopLocalComputerSchema.parse(await desktop?.localComputer()),
		enabled: Boolean(desktop),
		staleTime: 30_000,
	});
	if (!desktop) {
		return <AgentProfileProjectSelectorContent {...input} />;
	}
	if (native.isPending) {
		return (
			<output className="text-muted-foreground text-sm">
				Checking this computer…
			</output>
		);
	}
	const local = native.data;
	const mismatch =
		local?.status === "available" &&
		input.target &&
		(input.target.deviceId !== local.target.deviceId ||
			input.target.runtimeLane !== local.target.runtimeLane);
	if (native.isError || local?.status !== "available" || mismatch) {
		let message =
			"Couldn’t check this computer for folder selection. Try again.";
		if (local?.status === "unavailable") {
			message = local.message;
		}
		if (mismatch) {
			message =
				"This Agent runs on another computer or environment. Open Desktop there to change its working folder.";
		}
		return (
			<div className="grid gap-2">
				<p className="text-sm" role="alert">
					{message}
				</p>
				<Button onClick={() => native.refetch()} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	return (
		<AgentProfileProjectSelectorContent
			{...input}
			key={`${local.accountId}:${local.target.deviceId}:${local.target.runtimeLane}`}
			target={local.target}
		/>
	);
}

function AgentProfileProjectSelectorContent(input: ProjectSelectorInput) {
	const localControlsDisabled = isLocalControlDisabled(input);
	const controller = useProjectDiscovery({
		target: input.target,
		includeCandidates: false,
		organizationId: input.organizationId,
		projects: input.projects.filter(
			(project) => project.id === input.projectId
		),
	});
	const savedView = input.projectId
		? controller.projectView(input.projectId)
		: null;
	const search = useProjectDiscovery({
		target: input.target,
		organizationId: input.organizationId,
		projects: input.projects.filter(
			(project) => project.id === input.projectId
		),
		enabled: Boolean(
			savedView?.status === "ready" && savedView.connections.length === 0
		),
	});
	const view =
		savedView?.status === "ready" && savedView.connections.length === 0
			? search.projectView(input.projectId)
			: savedView;

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
	const [pendingDefaultConnection, setPendingDefaultConnection] =
		useState<LocalProjectControlConnection | null>(null);
	const source = resolveFolderSource(input);
	const automaticSelectionKeyRef = useRef<string | null>(null);
	const onConnectionReady = input.onConnectionReady;
	const selectedProjectName =
		input.projects.find((project) => project.id === input.projectId)?.name ??
		"this Project";
	const pickerDeviceId = input.target
		? (controller.folderPickerTarget?.deviceId ?? null)
		: resolveLocalFolderPickerDeviceId(controller.computer);

	useEffect(() => {
		if (localControlsDisabled) {
			setPendingDefaultConnection(null);
			setPendingFolderMove(null);
		}
	}, [localControlsDisabled]);

	useEffect(() => {
		const connection =
			view?.status === "ready"
				? (view.connections.find(
						(candidate) =>
							candidate.status === "available" && candidate.isDefault
					) ?? null)
				: null;
		const key = `${input.projectId}:${connection?.bindingGeneration ?? "unavailable"}`;
		if (automaticSelectionKeyRef.current === key) {
			return;
		}
		automaticSelectionKeyRef.current = key;
		onConnectionReady(connection);
	}, [input.projectId, onConnectionReady, view]);

	const promoteConnectionToDefault = async (
		connection: LocalProjectControlConnection,
		unavailableMessage: string
	): Promise<LocalProjectControlConnection> => {
		if (localControlsDisabled) {
			throw new Error(
				"Wait until this task finishes to change a folder on this computer."
			);
		}
		const response = await setCurrentComputerProjectDefaultConnection({
			target: input.target,
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

	const selectConnection = (connection: LocalProjectControlConnection) => {
		if (localControlsDisabled || connection.status !== "available") {
			return;
		}
		if (connection.isDefault) {
			input.onConnectionReady(connection);
			return;
		}
		setPendingDefaultConnection(connection);
	};
	const confirmDefaultConnection = async (
		connection: LocalProjectControlConnection
	) => {
		setPendingOperation(`default:${connection.bindingGeneration}`);
		setErrorMessage(null);
		try {
			const selected = await promoteConnectionToDefault(
				connection,
				"The selected Project folder is no longer connected."
			);
			input.onConnectionReady(selected);
			setPendingDefaultConnection(null);
		} catch (error) {
			setErrorMessage(resolveLocalProjectControlErrorMessage(error));
		}
		setPendingOperation(null);
	};

	const selectConnectedPath = (
		response: LocalProjectControlConnectResponse
	) => {
		const connection: LocalProjectControlConnection = {
			bindingGeneration: response.bindingGeneration,
			isDefault: response.isDefault,
			path: response.canonicalPath,
			status: "available",
		};
		if (connection.isDefault) {
			controller.applyConnectionSnapshot(input.projectId, [
				...(savedView?.connections ?? [])
					.filter(
						(item) => item.bindingGeneration !== connection.bindingGeneration
					)
					.map((item) => ({ ...item, isDefault: false })),
				connection,
			]);
			input.onConnectionReady(connection);
			return;
		}
		controller.applyConnectionSnapshot(input.projectId, [
			...(savedView?.connections ?? []).filter(
				(item) => item.bindingGeneration !== connection.bindingGeneration
			),
			connection,
		]);
		setPendingDefaultConnection(connection);
	};

	const connectCandidate = async (candidateRequest?: {
		candidate: LocalProjectControlCandidate;
		moveConfirmationToken?: string;
		shareConfirmationToken?: string;
	}): Promise<void> => {
		if (localControlsDisabled) {
			return;
		}
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
				target: input.target,
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
				...(candidateRequest?.shareConfirmationToken
					? {
							shareConfirmationToken: candidateRequest.shareConfirmationToken,
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
				selectConnectedPath(response);
				setPendingFolderMove(null);
			}
		} catch (error) {
			if (
				(candidateRequest?.moveConfirmationToken ||
					candidateRequest?.shareConfirmationToken) &&
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
		moveConfirmationToken?: string,
		shareConfirmationToken?: string
	): Promise<void> => {
		if (localControlsDisabled) {
			return;
		}
		const path = declaredPath;
		if (path.trim().length === 0 || !isAbsoluteProjectPath(path)) {
			setErrorMessage("Enter the full folder path on this computer.");
			return;
		}
		setPendingOperation("path");
		setErrorMessage(null);
		try {
			const response = await connectCurrentComputerProjectPath({
				target: input.target,
				clientGeneration: controller.claimMutationGeneration(),
				...(confirm ? { confirmNonGit: true } : {}),
				declaredPath: path,
				expectedOrganizationId: input.organizationId,
				idempotencyKey: crypto.randomUUID(),
				moveConfirmationToken,
				shareConfirmationToken,
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
				selectConnectedPath(response);
				setConfirmNonGit(false);
				setDeclaredPath("");
				setPendingFolderMove(null);
			}
		} catch (error) {
			if (isLocalProjectControlFailureCode(error, "needs_confirmation")) {
				setConfirmNonGit(true);
			} else if (
				(moveConfirmationToken || shareConfirmationToken) &&
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
			<ProjectSourceControls
				{...input}
				disabled={input.disabled || pendingOperation !== null}
				onChangeProject={(value) => {
					input.onProjectChange(value);
					setErrorMessage(null);
					setDeclaredPath("");
					setConfirmNonGit(false);
					setPendingFolderMove(null);
					setPendingDefaultConnection(null);
					setSelectedCandidateId(null);
				}}
				onChangeSource={(value) => {
					input.onProjectChange("");
					if (value === "custom") {
						input.onUseAdvancedWorkspace?.();
					}
					if (value === "managed") {
						input.onUseManagedWorkspace?.();
					}
					if (value === "project") {
						input.onUseProjectWorkspace?.();
					}
					setErrorMessage(null);
					setPendingDefaultConnection(null);
				}}
				source={source}
			/>

			{input.projectId && input.onUseManagedWorkspace ? (
				<Button
					className="justify-self-start"
					disabled={
						input.disabled ||
						input.localFolderChangesBlocked ||
						pendingOperation !== null
					}
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
					disabled={localControlsDisabled || pendingOperation !== null}
					onConnectCandidate={connectCandidate}
					onConnectPath={connectDeclaredPath}
					onDeclaredPathChange={(path) => {
						setDeclaredPath(path);
						setConfirmNonGit(false);
						setPendingFolderMove(null);
						setErrorMessage(null);
					}}
					onRetry={() => {
						setErrorMessage(null);
						controller.refresh();
						search.refresh();
					}}
					onSelectConnection={selectConnection}
					onSelectedCandidateChange={setSelectedCandidateId}
					pendingOperation={pendingOperation}
					pickerDeviceId={pickerDeviceId}
					runtimeLane={input.target?.runtimeLane}
					selectedBindingGeneration={input.selectedBindingGeneration}
					selectedCandidateId={selectedCandidateId}
					view={view}
				/>
			) : null}
			{input.projectId && view ? (
				<MissingProjectConnections connections={view.connections} />
			) : null}

			<ProjectDefaultFolderDialog
				connection={pendingDefaultConnection}
				errorMessage={errorMessage}
				onCancel={() => {
					setPendingDefaultConnection(null);
					setErrorMessage(null);
				}}
				onConfirm={confirmDefaultConnection}
				pending={pendingOperation !== null}
				projectName={selectedProjectName}
			/>

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
				onShare={() => {
					const shareConfirmationToken =
						pendingFolderMove?.conflict.shareConfirmationToken;
					if (!shareConfirmationToken) {
						return;
					}
					if (pendingFolderMove?.kind === "candidate") {
						connectCandidate({
							candidate: pendingFolderMove.candidate,
							shareConfirmationToken,
						}).catch(() => undefined);
					} else if (pendingFolderMove?.kind === "declared_path") {
						connectDeclaredPath(
							pendingFolderMove.confirmNonGit,
							undefined,
							shareConfirmationToken
						).catch(() => undefined);
					}
				}}
				open={pendingFolderMove !== null}
				pending={pendingOperation !== null}
				projectName={selectedProjectName}
			/>

			<WorkspaceFallbackControls
				disabled={localControlsDisabled}
				manualPath={input.manualPath}
				onManualPathChange={input.onManualPathChange}
				pickerDeviceId={pickerDeviceId}
				runtimeLane={input.target?.runtimeLane}
				visible={source === "custom"}
				wasProjectSelected={Boolean(input.projectId)}
				workspaceFallbackMode={input.workspaceFallbackMode}
			/>

			{errorMessage && !pendingFolderMove && !pendingDefaultConnection ? (
				<p className="text-destructive text-xs leading-5">{errorMessage}</p>
			) : null}
		</section>
	);
}

function resolveFolderSource(input: {
	projectId: string;
	workspaceFallbackMode?: "advanced" | "managed" | "project" | null;
}) {
	if (input.projectId || input.workspaceFallbackMode === "project") {
		return "project";
	}
	if (input.workspaceFallbackMode === "advanced") {
		return "custom";
	}
	return input.workspaceFallbackMode === "managed" ? "managed" : "";
}

function isLocalControlDisabled(input: ProjectSelectorInput): boolean {
	return input.disabled || input.localFolderChangesBlocked === true;
}

const FOLDER_SOURCES = [
	{ value: "custom", label: "On this computer" },
	{ value: "project", label: "From a project" },
	{ value: "managed", label: "Let OpenMeld choose" },
];

function ProjectSourceControls(input: {
	disabled: boolean;
	localFolderChangesBlocked?: boolean;
	localFoldersOnly?: boolean;
	source: "project" | "custom" | "managed" | "";
	organizationId: string;
	projectId: string;
	projects: readonly Project[];
	onChangeSource: (source: string) => void;
	onChangeProject: (projectId: string) => void;
}) {
	return (
		<>
			<div className="grid gap-2">
				<Label htmlFor="working-folder-source">Folder source</Label>
				<WorkingFolderSelect
					disabled={input.disabled}
					id="working-folder-source"
					items={FOLDER_SOURCES.filter(
						(source) => !(input.localFoldersOnly && source.value === "project")
					).map((source) => ({
						...source,
						disabled:
							input.localFolderChangesBlocked && source.value !== "project",
					}))}
					onChange={input.onChangeSource}
					placeholder="Choose a folder source"
					value={input.source}
				/>
			</div>
			{input.source === "managed" ? (
				<p className="text-muted-foreground text-sm">
					OpenMeld will manage a working folder for this agent.
				</p>
			) : null}
			{input.source === "project" ? (
				<div className="grid gap-2">
					<Label htmlFor="agent-profile-project-select">Project</Label>
					<WorkingFolderSelect
						disabled={input.disabled}
						id="agent-profile-project-select"
						items={input.projects.map((project) => ({
							value: project.id,
							label: project.name,
						}))}
						onChange={input.onChangeProject}
						placeholder="Choose a project"
						value={input.projectId}
					/>
					<ProjectPickerActions
						disabled={
							input.disabled || Boolean(input.localFolderChangesBlocked)
						}
						key={input.organizationId}
						onProjectSelected={input.onChangeProject}
						organizationId={input.organizationId}
						projectId={input.projectId}
						projects={input.projects}
					/>
					<p className="text-muted-foreground text-xs">
						Projects are shared in this workspace. Each computer connects its
						own folder.
					</p>
				</div>
			) : null}
		</>
	);
}

function WorkspaceFallbackControls(input: {
	runtimeLane?: PeopleComputerTarget["runtimeLane"];
	disabled: boolean;
	manualPath: string;
	onManualPathChange: (path: string) => void;
	pickerDeviceId: string | null;
	visible: boolean;
	wasProjectSelected: boolean;
	workspaceFallbackMode?: "advanced" | "managed" | "project" | null;
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
							runtimeLane={input.runtimeLane}
							variant="default"
						/>
					) : null}
					{input.manualPath && !manualPathOpen ? (
						<SelectedLocalFolder path={input.manualPath} />
					) : null}
					{input.pickerDeviceId && !manualPathOpen ? (
						<Button
							className="justify-self-end"
							disabled={input.disabled}
							onClick={() => setManualPathOpen(true)}
							size="sm"
							type="button"
							variant="secondary"
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
	runtimeLane?: PeopleComputerTarget["runtimeLane"];
	onRetry: () => void;
	branch: AgentProfileProjectSelectorBranch;
	confirmNonGit: boolean;
	declaredPath: string;
	disabled: boolean;
	onConnectCandidate: () => Promise<void>;
	onConnectPath: (confirm: boolean) => Promise<void>;
	onDeclaredPathChange: (path: string) => void;
	onSelectedCandidateChange: (candidateId: string) => void;
	onSelectConnection: (connection: LocalProjectControlConnection) => void;
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
		const defaultConnection = input.view.connections.find(
			(connection) => connection.isDefault
		);
		return (
			<div className="grid min-w-0 gap-2 pt-1">
				<p className="font-medium text-sm">Folder on this computer</p>
				{defaultConnection ? (
					<SelectedLocalFolder path={defaultConnection.path} />
				) : null}
				{defaultConnection?.status === "missing" ? (
					<p className="text-destructive text-sm" role="alert">
						The default folder is unavailable. Choose another connected folder.
					</p>
				) : (
					<p className="text-muted-foreground text-xs">
						New sessions use this project’s default folder on this computer.
					</p>
				)}
				{availableConnections.some((connection) => !connection.isDefault) ? (
					<details>
						<summary className="cursor-pointer text-sm">
							Change default folder…
						</summary>
						<div className="mt-2 grid gap-2">
							{availableConnections
								.filter((connection) => !connection.isDefault)
								.map((connection) => (
									<div
										className="grid gap-1 rounded-md border p-3"
										key={connection.bindingGeneration}
									>
										<SelectedLocalFolder path={connection.path} />
										<Button
											className="justify-self-start"
											disabled={input.disabled}
											onClick={() => input.onSelectConnection(connection)}
											size="sm"
											variant="outline"
										>
											Use as default…
										</Button>
									</div>
								))}
						</div>
					</details>
				) : null}
			</div>
		);
	}

	return (
		<div className="grid min-w-0 gap-3 pt-1">
			{input.view.errorMessage ? (
				<p className="text-sm" role="alert">
					{input.view.errorMessage}{" "}
					<Button onClick={input.onRetry} size="sm" variant="ghost">
						Try again
					</Button>
				</p>
			) : null}
			{input.branch === "checking" ? (
				<output className="text-muted-foreground text-sm">
					Checking folders on this computer… You can also choose a folder below.
				</output>
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
				pending={input.pendingOperation === "path"}
				pickerDeviceId={input.pickerDeviceId}
				runtimeLane={input.runtimeLane}
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
	runtimeLane?: PeopleComputerTarget["runtimeLane"];
	confirmNonGit: boolean;
	disabled: boolean;
	onConnectPath: (confirm: boolean) => Promise<void>;
	onPathChange: (path: string) => void;
	path: string;
	pending: boolean;
	pickerDeviceId: string | null;
}) {
	const [manualPathOpen, setManualPathOpen] = useState(false);
	const connectLabel = input.confirmNonGit ? "Connect anyway" : "Connect";
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
					runtimeLane={input.runtimeLane}
					variant="default"
				/>
			) : null}
			{input.path && !manualPathOpen ? (
				<SelectedLocalFolder path={input.path} />
			) : null}
			{input.pickerDeviceId && !manualPathOpen ? (
				<Button
					className="justify-self-end"
					disabled={input.disabled}
					onClick={() => setManualPathOpen(true)}
					size="sm"
					type="button"
					variant="secondary"
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
					{input.pending ? "Connecting…" : connectLabel}
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
							<ScrollArea className="min-w-0 flex-1" orientation="horizontal">
								<span className="whitespace-nowrap">
									{candidate.canonicalPath}
								</span>
							</ScrollArea>
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
				<ScrollArea
					className="max-w-full"
					key={connection.bindingGeneration}
					orientation="horizontal"
				>
					<p className="whitespace-nowrap text-muted-foreground">
						{connection.path}
						{connection.isDefault ? " (current default)" : ""}
					</p>
				</ScrollArea>
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
