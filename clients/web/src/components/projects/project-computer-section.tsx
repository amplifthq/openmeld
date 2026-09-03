"use client";

import type {
	LocalProjectControlCandidate,
	LocalProjectControlConnection,
	LocalProjectControlPathConflictResponse,
	Project,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	resolveStatusToneBadgeClassName,
	resolveStatusToneStrongTextClassName,
	resolveStatusToneSurfaceClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { FolderOpenIcon, TrashIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { LocalFolderPickerButton } from "#/components/local-runtimes/local-folder-picker-button";
import { SelectedLocalFolder } from "#/components/local-runtimes/selected-local-folder";
import { resolveLocalFolderPickerDeviceId } from "#/lib/connect/local-folder-picker";
import {
	connectCurrentComputerProjectCandidate,
	connectCurrentComputerProjectPath,
	isLocalProjectControlFailureCode,
	LOCAL_PROJECT_CONTROL_UNREACHABLE_MESSAGE,
	removeCurrentComputerMissingProjectConnections,
	removeCurrentComputerProjectConnection,
	resolveLocalProjectControlErrorMessage,
	setCurrentComputerProjectDefaultConnection,
} from "#/lib/organizations/local-project-control";
import { FolderMoveConfirmationDialog } from "./folder-move-confirmation-dialog";
import { ProjectCandidatePicker } from "./project-candidate-picker";
import {
	ProjectCheckAgainButton,
	ProjectRefreshStatus,
} from "./project-check-again-button";
import { useProjectDiscovery } from "./use-project-discovery";

type RemovalRequest = {
	connection: LocalProjectControlConnection;
	replacementBindingGeneration: string | null;
};

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

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;

export function ProjectComputerSection(input: {
	organizationId: string;
	project: Project;
	projects: readonly Project[];
}) {
	const controller = useProjectDiscovery({
		organizationId: input.organizationId,
		projects: input.projects,
	});
	const view = controller.projectView(input.project.id);
	const summary = resolveComputerStateSummary({
		serviceState: controller.serviceState,
		status: view.status,
		projectStatus: view.discovery?.status ?? null,
		errorMessage: view.errorMessage ?? null,
	});
	const serviceSummary = resolveServiceStateSummary({
		projectStatus: view.discovery?.status ?? null,
		serviceState: controller.serviceState,
		status: view.status,
	});
	const pickerDeviceId = resolveLocalFolderPickerDeviceId(controller.computer);
	const [selectedCandidateIds, setSelectedCandidateIds] = useState<
		ReadonlySet<string>
	>(new Set());
	const [connectDialogOpen, setConnectDialogOpen] = useState(false);
	const [declaredPath, setDeclaredPath] = useState("");
	const [confirmNonGit, setConfirmNonGit] = useState(false);
	const [operation, setOperation] = useState<string | null>(null);
	const [operationError, setOperationError] = useState<string | null>(null);
	const [removalRequest, setRemovalRequest] = useState<RemovalRequest | null>(
		null
	);
	const [pendingFolderMove, setPendingFolderMove] =
		useState<PendingFolderMove | null>(null);
	const [removeMissingOpen, setRemoveMissingOpen] = useState(false);
	const candidates = view.discovery?.candidates ?? [];
	const selectedCandidates = candidates.filter((candidate) =>
		selectedCandidateIds.has(candidate.candidateId)
	);
	const currentSelectedCandidateIds = new Set(
		selectedCandidates.map((candidate) => candidate.candidateId)
	);
	const missingConnections = view.connections.filter(
		(connection) => connection.status === "missing"
	);
	const availableConnections = view.connections.filter(
		(connection) => connection.status === "available"
	);
	const defaultConnection = view.connections.find(
		(connection) => connection.isDefault
	);
	const defaultMissingWithHealthyAlternative = Boolean(
		defaultConnection?.status === "missing" && availableConnections.length > 0
	);

	const refreshAfterConnection = () => {
		setOperationError(null);
		controller.refresh();
	};

	const connectCandidates = async (moveConfirmation?: {
		candidateId: string;
		moveConfirmationToken: string;
	}): Promise<void> => {
		if (selectedCandidates.length === 0) {
			return;
		}
		setOperation("connect-candidates");
		setOperationError(null);
		const result = await connectProjectCandidates({
			candidates: selectedCandidates,
			clientGeneration: controller.claimMutationGeneration(),
			organizationId: input.organizationId,
			projectId: input.project.id,
			moveConfirmation,
		});
		setSelectedCandidateIds((current) => {
			const next = new Set(current);
			for (const candidateId of result.connectedCandidateIds) {
				next.delete(candidateId);
			}
			return next;
		});
		if (result.staleMoveConflict) {
			setPendingFolderMove(null);
			setOperation(null);
			await connectCandidates();
			return;
		}
		if (result.errorMessage) {
			setOperationError(result.errorMessage);
		}
		if (result.moveConflict) {
			setPendingFolderMove({
				candidate: result.moveConflict.candidate,
				conflict: result.moveConflict.conflict,
				kind: "candidate",
			});
		} else if (
			!result.errorMessage ||
			(moveConfirmation &&
				result.connectedCandidateIds.includes(moveConfirmation.candidateId))
		) {
			setPendingFolderMove(null);
		}
		if (
			result.connectedCandidateIds.length > 0 &&
			result.moveConflict === null
		) {
			controller.refresh();
		}
		setOperation(null);
	};

	const connectDeclaredPath = async (
		confirm: boolean,
		moveConfirmationToken?: string
	): Promise<void> => {
		if (
			declaredPath.trim().length === 0 ||
			!isAbsoluteProjectPath(declaredPath)
		) {
			setOperationError("Enter the full folder path on this computer.");
			return;
		}
		setOperation("connect-path");
		setOperationError(null);
		const clientGeneration = controller.claimMutationGeneration();
		try {
			const response = await connectCurrentComputerProjectPath({
				clientGeneration,
				...(confirm ? { confirmNonGit: true } : {}),
				declaredPath,
				expectedOrganizationId: input.organizationId,
				idempotencyKey: createIdempotencyKey(),
				...(moveConfirmationToken ? { moveConfirmationToken } : {}),
				projectId: input.project.id,
			});
			if (response.status === "rejected") {
				setConnectDialogOpen(false);
				setConfirmNonGit(false);
				setPendingFolderMove({
					confirmNonGit: confirm,
					conflict: response,
					kind: "declared_path",
				});
			} else {
				setConnectDialogOpen(false);
				setConfirmNonGit(false);
				setDeclaredPath("");
				setPendingFolderMove(null);
				refreshAfterConnection();
			}
		} catch (error) {
			if (isLocalProjectControlFailureCode(error, "needs_confirmation")) {
				setConfirmNonGit(true);
			} else if (
				moveConfirmationToken &&
				isLocalProjectControlFailureCode(error, "binding_generation_stale")
			) {
				setPendingFolderMove(null);
				setOperation(null);
				await connectDeclaredPath(confirm);
				return;
			} else {
				setOperationError(resolveLocalProjectControlErrorMessage(error));
			}
		}
		setOperation(null);
	};

	const setDefault = async (connection: LocalProjectControlConnection) => {
		setOperation(`default:${connection.bindingGeneration}`);
		setOperationError(null);
		const clientGeneration = controller.claimMutationGeneration();
		try {
			const response = await setCurrentComputerProjectDefaultConnection({
				clientGeneration,
				expectedOrganizationId: input.organizationId,
				idempotencyKey: createIdempotencyKey(),
				projectId: input.project.id,
				targetBindingGeneration: connection.bindingGeneration,
			});
			controller.applyConnectionSnapshot(
				input.project.id,
				response.connections
			);
			controller.refresh();
		} catch (error) {
			setOperationError(resolveLocalProjectControlErrorMessage(error));
		}
		setOperation(null);
	};

	const removeConnection = async () => {
		if (!removalRequest) {
			return;
		}
		setOperation("remove-connection");
		setOperationError(null);
		const clientGeneration = controller.claimMutationGeneration();
		try {
			const response = await removeCurrentComputerProjectConnection({
				bindingGeneration: removalRequest.connection.bindingGeneration,
				clientGeneration,
				expectedOrganizationId: input.organizationId,
				idempotencyKey: createIdempotencyKey(),
				projectId: input.project.id,
				...(removalRequest.replacementBindingGeneration
					? {
							replacementBindingGeneration:
								removalRequest.replacementBindingGeneration,
						}
					: {}),
			});
			controller.applyConnectionSnapshot(
				input.project.id,
				response.connections
			);
			setRemovalRequest(null);
			controller.refresh();
		} catch (error) {
			setOperationError(resolveLocalProjectControlErrorMessage(error));
		}
		setOperation(null);
	};

	const removeMissingConnections = async () => {
		setOperation("remove-missing");
		setOperationError(null);
		const clientGeneration = controller.claimMutationGeneration();
		try {
			const response = await removeCurrentComputerMissingProjectConnections({
				clientGeneration,
				expectedOrganizationId: input.organizationId,
				idempotencyKey: createIdempotencyKey(),
				projectId: input.project.id,
			});
			controller.applyConnectionSnapshot(
				input.project.id,
				response.connections
			);
			setRemoveMissingOpen(false);
			controller.refresh();
		} catch (error) {
			setOperationError(resolveLocalProjectControlErrorMessage(error));
		}
		setOperation(null);
	};

	return (
		<section
			aria-labelledby="project-computer-heading"
			className="grid gap-4 border-t pt-5"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="font-medium text-muted-foreground text-xs">
						This computer
					</p>
					<h2 className="font-medium text-xl" id="project-computer-heading">
						{summary.title}
					</h2>
					<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
						{summary.description}
					</p>
				</div>
				<Button
					onClick={() => {
						setOperationError(null);
						setConfirmNonGit(false);
						setConnectDialogOpen(true);
					}}
					variant="outline"
				>
					<FolderOpenIcon aria-hidden="true" /> Connect folder
				</Button>
			</div>

			<div
				className={cn(
					"grid gap-3 rounded-md border p-4",
					resolveStatusToneSurfaceClassName(summary.tone, "subtle")
				)}
			>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p className="font-medium">
							{controller.computer?.deviceDisplayName ?? "This computer"}
						</p>
						{serviceSummary.label ? (
							<p className="mt-1 text-muted-foreground text-xs">
								{serviceSummary.label}
							</p>
						) : null}
					</div>
					<Badge
						className={cn(
							"rounded-md",
							resolveStatusToneBadgeClassName(summary.tone)
						)}
						variant="outline"
					>
						{summary.statusLabel}
					</Badge>
				</div>
				<ProjectCheckAgainButton
					className="justify-self-start"
					initialChecking={view.status === "checking"}
					isRefreshing={controller.isRefreshing}
					onCheck={controller.refresh}
					size="sm"
				/>
			</div>
			<ProjectRefreshStatus message={controller.refreshErrorMessage} />

			{candidates.length > 0 ? (
				<CandidateConnectionPicker
					candidates={candidates}
					connecting={operation === "connect-candidates"}
					disabled={controller.isRefreshing}
					onConnect={() => {
						connectCandidates().catch((error: unknown) => {
							console.error("Failed to connect Project folders.", error);
						});
					}}
					onSelectionChange={setSelectedCandidateIds}
					selectedCandidateIds={currentSelectedCandidateIds}
				/>
			) : null}

			{view.connections.length > 0 ? (
				<ConnectionList
					connections={view.connections}
					onLocate={(connection) => {
						setDeclaredPath(connection.path);
						setConnectDialogOpen(true);
					}}
					onMakeDefault={(connection) => {
						setDefault(connection).catch(() => undefined);
					}}
					onRemove={(connection) =>
						setRemovalRequest({
							connection,
							replacementBindingGeneration: null,
						})
					}
					operation={operation}
				/>
			) : null}

			{missingConnections.length >= 2 &&
			defaultMissingWithHealthyAlternative ? (
				<p className={resolveStatusToneStrongTextClassName("warning")}>
					Choose an available connected folder as the default before removing
					missing connections.
				</p>
			) : null}

			{missingConnections.length >= 2 &&
			!defaultMissingWithHealthyAlternative ? (
				<Button
					className="justify-self-start"
					onClick={() => setRemoveMissingOpen(true)}
					variant="outline"
				>
					<TrashIcon aria-hidden="true" /> Remove missing connections
				</Button>
			) : null}

			{operationError &&
			!(
				connectDialogOpen ||
				pendingFolderMove ||
				removalRequest ||
				removeMissingOpen
			) ? (
				<p
					className={resolveStatusToneStrongTextClassName("danger")}
					role="alert"
				>
					{operationError}
				</p>
			) : null}

			<ConnectFolderDialog
				canChooseFolder={pickerDeviceId !== null}
				computerName={controller.computer?.deviceDisplayName ?? "this computer"}
				confirmNonGit={confirmNonGit}
				errorMessage={operationError}
				onBack={() => setConfirmNonGit(false)}
				onOpenChange={(open) => {
					if (!operation) {
						setConnectDialogOpen(open);
					}
				}}
				onPathChange={setDeclaredPath}
				onSubmit={(confirm) => {
					connectDeclaredPath(confirm).catch(() => undefined);
				}}
				open={connectDialogOpen}
				path={declaredPath}
				pending={operation === "connect-path"}
				pickerDeviceId={pickerDeviceId}
			/>

			<FolderMoveConfirmationDialog
				conflict={pendingFolderMove?.conflict ?? null}
				errorMessage={operationError}
				onConfirm={() => {
					if (pendingFolderMove?.kind === "candidate") {
						connectCandidates({
							candidateId: pendingFolderMove.candidate.candidateId,
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
					if (!(open || operation)) {
						if (pendingFolderMove?.kind === "candidate") {
							controller.refresh();
						}
						setOperationError(null);
						setPendingFolderMove(null);
					}
				}}
				open={pendingFolderMove !== null}
				pending={
					operation === "connect-candidates" || operation === "connect-path"
				}
				projectName={input.project.name}
			/>

			<RemoveConnectionDialog
				connections={view.connections}
				errorMessage={operationError}
				onConfirm={() => {
					removeConnection().catch(() => undefined);
				}}
				onOpenChange={(open) => {
					if (!(open || operation === "remove-connection")) {
						setRemovalRequest(null);
					}
				}}
				onReplacementChange={(replacementBindingGeneration) => {
					setRemovalRequest((current) =>
						current ? { ...current, replacementBindingGeneration } : current
					);
				}}
				pending={operation === "remove-connection"}
				request={removalRequest}
			/>

			<Dialog onOpenChange={setRemoveMissingOpen} open={removeMissingOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove missing connections?</DialogTitle>
						<DialogDescription>
							Only folders currently reported as missing will be disconnected.
							OpenMeld never removes them automatically because drives and
							worktrees can return.
						</DialogDescription>
					</DialogHeader>
					{operationError ? (
						<p
							className={resolveStatusToneStrongTextClassName("danger")}
							role="alert"
						>
							{operationError}
						</p>
					) : null}
					<DialogFooter>
						<Button
							onClick={() => setRemoveMissingOpen(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={operation === "remove-missing"}
							onClick={() => {
								removeMissingConnections().catch(() => undefined);
							}}
							variant="destructive"
						>
							Remove missing connections
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

function CandidateConnectionPicker(input: {
	candidates: readonly LocalProjectControlCandidate[];
	connecting: boolean;
	disabled: boolean;
	onConnect: () => void;
	onSelectionChange: (candidateIds: ReadonlySet<string>) => void;
	selectedCandidateIds: ReadonlySet<string>;
}) {
	const selectedCount = input.selectedCandidateIds.size;
	let actionLabel = "Connect selected folders";
	if (selectedCount === 1) {
		actionLabel = "Connect 1 folder";
	} else if (selectedCount > 1) {
		actionLabel = `Connect ${String(selectedCount)} folders`;
	}
	return (
		<fieldset className="grid gap-3 rounded-md border p-4">
			<legend className="px-1 font-medium text-sm">Matching folders</legend>
			<p className="text-muted-foreground text-xs">
				Choose one or more folders where agents should work.
			</p>
			<ProjectCandidatePicker
				candidates={input.candidates}
				disabled={input.disabled || input.connecting}
				onSelectionChange={input.onSelectionChange}
				selectedCandidateIds={input.selectedCandidateIds}
				selectionMode="multiple"
			/>
			<Button
				disabled={input.connecting || input.disabled || selectedCount === 0}
				onClick={input.onConnect}
			>
				{actionLabel}
			</Button>
		</fieldset>
	);
}

async function connectProjectCandidates(input: {
	candidates: readonly LocalProjectControlCandidate[];
	clientGeneration: number;
	moveConfirmation?: {
		candidateId: string;
		moveConfirmationToken: string;
	};
	organizationId: string;
	projectId: string;
}): Promise<{
	connectedCandidateIds: readonly string[];
	errorMessage: string | null;
	moveConflict: {
		candidate: LocalProjectControlCandidate;
		conflict: LocalProjectControlPathConflictResponse;
	} | null;
	staleMoveConflict: boolean;
}> {
	const connectedCandidateIds: string[] = [];
	for (const candidate of input.candidates) {
		try {
			const response = await connectCurrentComputerProjectCandidate({
				candidateId: candidate.candidateId,
				candidatePath: candidate.canonicalPath,
				clientGeneration: input.clientGeneration,
				expectedOrganizationId: input.organizationId,
				idempotencyKey: createIdempotencyKey(),
				...(input.moveConfirmation?.candidateId === candidate.candidateId
					? {
							moveConfirmationToken:
								input.moveConfirmation.moveConfirmationToken,
						}
					: {}),
				projectId: input.projectId,
			});
			if (response.status === "rejected") {
				return {
					connectedCandidateIds,
					errorMessage: null,
					moveConflict: { candidate, conflict: response },
					staleMoveConflict: false,
				};
			}
			connectedCandidateIds.push(candidate.candidateId);
		} catch (error) {
			if (
				input.moveConfirmation?.candidateId === candidate.candidateId &&
				isLocalProjectControlFailureCode(error, "binding_generation_stale")
			) {
				return {
					connectedCandidateIds,
					errorMessage: null,
					moveConflict: null,
					staleMoveConflict: true,
				};
			}
			const failure = resolveLocalProjectControlErrorMessage(error);
			return {
				connectedCandidateIds,
				errorMessage:
					connectedCandidateIds.length > 0
						? `${String(connectedCandidateIds.length)} of ${String(input.candidates.length)} folders connected. ${failure}`
						: failure,
				moveConflict: null,
				staleMoveConflict: false,
			};
		}
	}
	return {
		connectedCandidateIds,
		errorMessage: null,
		moveConflict: null,
		staleMoveConflict: false,
	};
}

function ConnectionList(input: {
	connections: readonly LocalProjectControlConnection[];
	onLocate: (connection: LocalProjectControlConnection) => void;
	onMakeDefault: (connection: LocalProjectControlConnection) => void;
	onRemove: (connection: LocalProjectControlConnection) => void;
	operation: string | null;
}) {
	return (
		<div className="grid gap-2">
			<div>
				<h3 className="font-medium text-sm">Connected folders</h3>
				<p className="text-muted-foreground text-xs">
					Agents start new sessions and Wakes in the default folder.
				</p>
			</div>
			<ul className="grid gap-2">
				{input.connections.map((connection) => (
					<li
						className="grid gap-2 rounded-md border p-3"
						key={connection.bindingGeneration}
					>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="break-all font-mono text-sm">{connection.path}</p>
								<div className="mt-1 flex flex-wrap gap-1.5">
									{connection.isDefault ? (
										<Badge className="rounded-md">Default</Badge>
									) : null}
									{connection.status === "missing" ? (
										<Badge
											className={cn(
												"rounded-md",
												resolveStatusToneBadgeClassName("warning")
											)}
											variant="outline"
										>
											Missing
										</Badge>
									) : null}
								</div>
							</div>
							<div className="flex flex-wrap gap-1.5">
								{connection.status === "missing" ? (
									<Button
										onClick={() => input.onLocate(connection)}
										size="sm"
										variant="outline"
									>
										Locate folder
									</Button>
								) : null}
								{connection.isDefault ? null : (
									<Button
										disabled={
											input.operation ===
											`default:${connection.bindingGeneration}`
										}
										onClick={() => input.onMakeDefault(connection)}
										size="sm"
										variant="outline"
									>
										Make default
									</Button>
								)}
								<Button
									onClick={() => input.onRemove(connection)}
									size="sm"
									variant="ghost"
								>
									Remove connection
								</Button>
							</div>
						</div>
						{connection.status === "missing" ? (
							<p className={resolveStatusToneStrongTextClassName("warning")}>
								This folder is no longer available on this computer.
							</p>
						) : null}
					</li>
				))}
			</ul>
		</div>
	);
}

function ConnectFolderDialog(input: {
	canChooseFolder: boolean;
	computerName: string;
	confirmNonGit: boolean;
	errorMessage: string | null;
	onBack: () => void;
	onOpenChange: (open: boolean) => void;
	onPathChange: (value: string) => void;
	onSubmit: (confirmNonGit: boolean) => void;
	open: boolean;
	path: string;
	pending: boolean;
	pickerDeviceId: string | null;
}) {
	const [manualPathOpen, setManualPathOpen] = useState(false);
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			setManualPathOpen(false);
		}
		input.onOpenChange(open);
	};
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		input.onSubmit(false);
	};
	return (
		<Dialog onOpenChange={handleOpenChange} open={input.open}>
			<DialogContent>
				{input.confirmNonGit ? (
					<>
						<DialogHeader>
							<DialogTitle>Connect this folder anyway?</DialogTitle>
							<DialogDescription>
								OpenMeld couldn’t verify this folder with Git. You can still
								connect it, but automatic matching and worktree discovery won’t
								be available.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button onClick={input.onBack} variant="outline">
								Go back
							</Button>
							<Button
								disabled={input.pending}
								onClick={() => input.onSubmit(true)}
							>
								Connect anyway
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Connect OpenMeld on this computer</DialogTitle>
							<DialogDescription>
								Choose the Project folder on {input.computerName}. OpenMeld will
								validate it on that computer.
							</DialogDescription>
						</DialogHeader>
						<form className="grid gap-4" noValidate onSubmit={submit}>
							{input.canChooseFolder && input.pickerDeviceId ? (
								<LocalFolderPickerButton
									allowMultiple={false}
									deviceId={input.pickerDeviceId}
									disabled={input.pending}
									label="Choose a folder on this computer"
									onSelect={(paths) => {
										const path = paths[0];
										if (path !== undefined) {
											input.onPathChange(path);
										}
									}}
									purpose="project_connection"
									variant="default"
								/>
							) : null}
							{input.path && !manualPathOpen ? (
								<SelectedLocalFolder
									path={input.path}
									testId="project-selected-folder"
								/>
							) : null}
							{input.canChooseFolder && !manualPathOpen ? (
								<Button
									className="justify-self-start"
									onClick={() => setManualPathOpen(true)}
									size="sm"
									type="button"
									variant="ghost"
								>
									Enter path manually
								</Button>
							) : null}
							{!input.canChooseFolder || manualPathOpen ? (
								<div className="grid gap-1.5">
									<Label htmlFor="project-folder-path">Folder path</Label>
									<p className="text-muted-foreground text-xs/relaxed">
										Enter the full path on {input.computerName}.
									</p>
									<Input
										autoFocus
										id="project-folder-path"
										onChange={(event) => input.onPathChange(event.target.value)}
										placeholder="/Users/felix/Desktop/work/openmeld"
										value={input.path}
									/>
								</div>
							) : null}
							{input.errorMessage ? (
								<p
									className={resolveStatusToneStrongTextClassName("danger")}
									role="alert"
								>
									{input.errorMessage}
								</p>
							) : null}
							<DialogFooter>
								<Button
									onClick={() => input.onOpenChange(false)}
									type="button"
									variant="outline"
								>
									Cancel
								</Button>
								<Button disabled={input.pending} type="submit">
									Check and connect
								</Button>
							</DialogFooter>
						</form>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function RemoveConnectionDialog(input: {
	connections: readonly LocalProjectControlConnection[];
	errorMessage: string | null;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	onReplacementChange: (bindingGeneration: string) => void;
	pending: boolean;
	request: RemovalRequest | null;
}) {
	const alternatives = input.connections.filter(
		(connection) =>
			connection.bindingGeneration !==
			input.request?.connection.bindingGeneration
	);
	const needsReplacement = Boolean(
		input.request?.connection.isDefault && alternatives.length > 0
	);
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.request !== null}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Remove this connection?</DialogTitle>
					<DialogDescription>
						This disconnects the folder from this Project on this computer. It
						does not delete the folder or its files.
					</DialogDescription>
				</DialogHeader>
				{needsReplacement ? (
					<fieldset className="grid gap-2">
						<legend className="font-medium text-sm">
							Choose the new default folder first
						</legend>
						{alternatives.map((connection) => (
							<label
								className="flex items-start gap-2 rounded-md border p-3"
								key={connection.bindingGeneration}
							>
								<input
									checked={
										input.request?.replacementBindingGeneration ===
										connection.bindingGeneration
									}
									className="mt-1"
									name="replacement-connection"
									onChange={() =>
										input.onReplacementChange(connection.bindingGeneration)
									}
									type="radio"
								/>
								<span className="min-w-0 break-all font-mono text-xs">
									{connection.path}
									{connection.status === "missing" ? " · Missing" : ""}
								</span>
							</label>
						))}
					</fieldset>
				) : null}
				{input.errorMessage ? (
					<p
						className={resolveStatusToneStrongTextClassName("danger")}
						role="alert"
					>
						{input.errorMessage}
					</p>
				) : null}
				<DialogFooter>
					<Button onClick={() => input.onOpenChange(false)} variant="outline">
						Cancel
					</Button>
					<Button
						disabled={
							input.pending ||
							(needsReplacement && !input.request?.replacementBindingGeneration)
						}
						onClick={input.onConfirm}
						variant="destructive"
					>
						Remove connection
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function resolveComputerStateSummary(input: {
	errorMessage: string | null;
	projectStatus:
		| "connected"
		| "connected_folder_missing"
		| "found"
		| "not_found"
		| "verification_unavailable"
		| null;
	serviceState: string;
	status:
		| "checking"
		| "discovery_failed"
		| "ready"
		| "service_unavailable"
		| "update_required";
}): {
	description: string;
	statusLabel: string;
	title: string;
	tone: "checking" | "found" | "muted" | "ready" | "warning";
} {
	if (input.status === "checking") {
		return {
			description: "Looking for matching folders and worktrees.",
			statusLabel: "Checking",
			title: "Checking this computer",
			tone: "checking",
		};
	}
	if (
		input.status === "service_unavailable" ||
		input.status === "update_required"
	) {
		const updateRequired = input.status === "update_required";
		return {
			description: updateRequired
				? "Update OpenMeld on this computer to connect folders from the Web."
				: (input.errorMessage ?? LOCAL_PROJECT_CONTROL_UNREACHABLE_MESSAGE),
			statusLabel: updateRequired ? "Update required" : "Unavailable",
			title: "Computer unavailable",
			tone: "warning",
		};
	}
	if (input.status === "discovery_failed") {
		return {
			description:
				input.errorMessage ?? "Check again or connect a folder manually.",
			statusLabel: "Check failed",
			title: "Couldn’t check this computer",
			tone: "warning",
		};
	}
	switch (input.projectStatus) {
		case "connected":
			return {
				description: "Agents will start in the default folder below.",
				statusLabel: "Connected",
				title: "Folder connected",
				tone: "ready",
			};
		case "connected_folder_missing":
			return {
				description: "Locate it or choose another default folder.",
				statusLabel: "Unavailable",
				title: "Default folder unavailable",
				tone: "warning",
			};
		case "found":
			return {
				description: "Choose where agents should work.",
				statusLabel: "Found",
				title: "Matching folders found",
				tone: "found",
			};
		case "verification_unavailable":
			return {
				description: "OpenMeld couldn’t verify repositories with Git.",
				statusLabel: "Couldn’t verify",
				title: "Couldn’t verify folders",
				tone: "warning",
			};
		default:
			return {
				description: "Connect a folder so agents can work on this Project.",
				statusLabel: "Not found",
				title: "No matching folders found",
				tone: "muted",
			};
	}
}

function resolveServiceStateSummary(input: {
	projectStatus:
		| "connected"
		| "connected_folder_missing"
		| "found"
		| "not_found"
		| "verification_unavailable"
		| null;
	serviceState: string;
	status:
		| "checking"
		| "discovery_failed"
		| "ready"
		| "service_unavailable"
		| "update_required";
}): { label: string | null } {
	if (input.status === "service_unavailable") {
		return { label: "Computer unavailable" };
	}
	if (
		input.status === "update_required" ||
		input.serviceState === "update_required"
	) {
		return { label: "Computer needs an OpenMeld update" };
	}
	if (input.serviceState === "connected") {
		return {
			label:
				input.status === "ready" && input.projectStatus === "connected"
					? null
					: "Computer connected",
		};
	}
	if (input.serviceState === "checking") {
		return { label: "Checking computer" };
	}
	return { label: "Computer unavailable" };
}

function isAbsoluteProjectPath(value: string): boolean {
	return (
		value.startsWith("/") ||
		value.startsWith("\\\\") ||
		WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
	);
}

function createIdempotencyKey(): string {
	return crypto.randomUUID();
}
