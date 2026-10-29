"use client";

import type {
	SpaceAccessMode,
	SpaceLinkJoinPolicy,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Dialog, DialogTrigger } from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { SettingsDialogContent } from "@openmeld/ui/components/settings-dialog-content";
import { SettingsNav } from "@openmeld/ui/components/settings-nav";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { CopyIcon, DotsThreeIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { formatWebCliCommand } from "#/lib/cli-entry-command";
import { copyTextToClipboard } from "#/lib/clipboard";
import type { SpaceAccessUpdateInput } from "./space-access-editor";
import { SpaceAccessSettings } from "./space-access-settings";
import { SpaceInfoNotificationsSection } from "./space-info-notifications-section";
import { SpaceNameEditor } from "./space-name-editor";
import { SpaceOwnersSection } from "./space-owners-section";
import type { SpaceSharingDraftController } from "./use-space-sharing-draft";

type SpaceInfoLeaveAction = {
	errorMessage: string | null;
	isPending: boolean;
	onLeave: () => Promise<void> | void;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the shared settings shell keeps mutually exclusive sections in one dialog.
export function SpaceSettingsDialog(input: {
	deleted?: boolean;
	access: {
		allowGuests?: boolean;
		canManage: boolean;
		errorMessage: string | null;
		isPending: boolean;
		linkJoinPolicy?: SpaceLinkJoinPolicy;
		mode: SpaceAccessMode;
		onSetMode: (input: SpaceAccessUpdateInput) => Promise<void>;
	};
	currentProfileName: string | null;
	draftController: SpaceSharingDraftController;
	openMeldProfileId?: string;
	deleteAction: {
		errorMessage: string | null;
		isPending: boolean;
		isVisible: boolean;
		onDelete: () => Promise<void> | void;
	};
	leaveAction?: SpaceInfoLeaveAction;
	isCenterAgentDirectMessage?: boolean;
	isDirectMessage?: boolean;
	name: {
		canManage: boolean;
		errorMessage: string | null;
		isPending: boolean;
		onSave: (name: string) => Promise<void>;
		value: string;
	};
	onOpenChange?: (open: boolean) => void;
	onOpenInvitations?: () => void;
	onOpenShare?: () => void;
	open?: boolean;
	initialSection?: "access" | "advanced" | "general" | "members";
	showTrigger?: boolean;
	spaceId: string;
	visibility?: "public" | "private";
}) {
	const [internalOpen, setInternalOpen] = useState(false);
	const [section, setSection] = useState("general");
	const [isConfirmingLeave, setIsConfirmingLeave] = useState(false);
	const cliJoinCommand = buildSpaceCliJoinCommand(input.spaceId);
	const isDirectConversation =
		input.isCenterAgentDirectMessage === true || input.isDirectMessage === true;
	const canManageName = input.name.canManage && !isDirectConversation;
	const isSpaceMutationPending = resolveSpaceInfoMutationPending({
		deleteAction: input.deleteAction,
		leaveAction: input.leaveAction,
	});
	const showSpaceAccessControls = !isDirectConversation;
	const conversationLabel = isDirectConversation ? "Chat" : "Space";
	const open = input.open ?? internalOpen;
	const handleOpenChange = input.onOpenChange ?? setInternalOpen;

	useEffect(() => {
		if (open && input.initialSection) {
			setSection(input.initialSection);
		}
	}, [input.initialSection, open]);

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			{input.showTrigger === false ? null : (
				<Tooltip>
					<TooltipTrigger
						render={
							<DialogTrigger
								render={
									<Button
										aria-label="Space settings"
										size="icon-sm"
										type="button"
										variant="ghost"
									>
										<DotsThreeIcon />
									</Button>
								}
							/>
						}
					/>
					<TooltipContent side="bottom">Space settings</TooltipContent>
				</Tooltip>
			)}
			<SettingsDialogContent
				contentScrollable={section !== "access"}
				description="Manage this conversation."
				navigation={
					<SettingsNav
						activeSectionId={section}
						items={[
							{ id: "general", title: "General" },
							...(isDirectConversation
								? []
								: [
										{ id: "members", title: "Members" },
										{ id: "access", title: "Share & Access" },
									]),
							{ id: "advanced", title: "Advanced" },
						]}
						onNavigate={setSection}
					/>
				}
				scrollTestId="space-info-dialog-scroll-area"
				title={`${conversationLabel} settings`}
			>
				{section === "access" ? null : (
					<h2 className="pr-8 font-medium text-base">
						{
							{
								general: "General",
								access: "Share & Access",
								advanced: "Advanced",
								members: "Members",
							}[section]
						}
					</h2>
				)}
				{section === "advanced" && input.currentProfileName ? (
					<SpaceInfoReadOnlyField
						label="Joined profile"
						value={input.currentProfileName}
					/>
				) : null}
				{section === "general" &&
					(canManageName ? (
						<SpaceNameEditor
							currentName={input.name.value}
							errorMessage={input.name.errorMessage}
							isPending={input.name.isPending}
							onSave={input.name.onSave}
						/>
					) : (
						<SpaceInfoReadOnlyField
							label={`${conversationLabel} name`}
							value={input.name.value}
						/>
					))}
				{section === "advanced" && (
					<>
						<SpaceInfoCopyField
							ariaLabel="Copy Space ID"
							label="Space ID"
							successMessage="Space ID copied."
							value={input.spaceId}
						/>
						{showSpaceAccessControls && !input.deleted ? (
							<SpaceInfoCopyField
								ariaLabel="Copy CLI join command"
								label="CLI join command"
								successMessage="CLI command copied."
								value={cliJoinCommand}
							/>
						) : null}
					</>
				)}
				{section === "general" && (
					<SpaceInfoNotificationsSection spaceId={input.spaceId} />
				)}
				{section === "members" && showSpaceAccessControls ? (
					<div className="grid gap-4">
						{input.onOpenInvitations ? (
							<div className="flex justify-end">
								<Button
									onClick={input.onOpenInvitations}
									size="sm"
									type="button"
									variant="secondary"
								>
									Invite people to join
								</Button>
							</div>
						) : null}
						<SpaceOwnersSection
							canManage={input.access.canManage}
							collapsible={false}
							openMeldProfileId={input.openMeldProfileId}
							spaceId={input.spaceId}
						/>
					</div>
				) : null}
				{section === "access" && showSpaceAccessControls ? (
					<SpaceAccessSettings
						accessMode={input.access.mode}
						allowGuests={input.access.allowGuests}
						canManageAccess={input.access.canManage}
						draftController={input.draftController}
						errorMessage={input.access.errorMessage}
						isPending={input.access.isPending}
						linkJoinPolicy={input.access.linkJoinPolicy}
						onOpenInvitations={input.onOpenInvitations}
						onOpenShare={input.onOpenShare}
						onSetAccessMode={input.access.onSetMode}
						openMeldProfileId={input.openMeldProfileId}
						spaceId={input.spaceId}
						visibility={input.visibility}
					/>
				) : null}
				{section === "advanced" && showSpaceAccessControls ? (
					<SpaceInfoLeaveSection
						action={input.leaveAction}
						deleted={input.deleted}
						isConfirming={isConfirmingLeave}
						isSpaceMutationPending={isSpaceMutationPending}
						onConfirmingChange={setIsConfirmingLeave}
					/>
				) : null}
				{section === "advanced" &&
				showSpaceAccessControls &&
				input.deleteAction.isVisible ? (
					<SpaceInfoDeleteSection
						deleteSpaceErrorMessage={input.deleteAction.errorMessage}
						isDeleteSpacePending={input.deleteAction.isPending}
						isSpaceMutationPending={isSpaceMutationPending}
						onDeleteSpace={() => {
							handleOpenChange(false);
							return input.deleteAction.onDelete();
						}}
						onStartDeleteConfirmation={() => setIsConfirmingLeave(false)}
					/>
				) : null}
			</SettingsDialogContent>
		</Dialog>
	);
}

function resolveSpaceInfoMutationPending(input: {
	deleteAction: { isPending: boolean };
	leaveAction?: SpaceInfoLeaveAction;
}): boolean {
	return input.deleteAction.isPending || input.leaveAction?.isPending === true;
}

function SpaceInfoLeaveSection(input: {
	deleted?: boolean;
	action?: SpaceInfoLeaveAction;
	isConfirming: boolean;
	isSpaceMutationPending: boolean;
	onConfirmingChange: (isConfirming: boolean) => void;
}) {
	if (!input.action) {
		return null;
	}
	const pendingLabel = input.deleted ? "Removing..." : "Leaving...";
	const confirmLabel = input.deleted ? "Remove from my list" : "Confirm leave";

	return (
		<div className="min-w-0 border-border/60 border-t pt-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="font-medium text-sm">
						{input.deleted ? "Remove from my list" : "Leave space"}
					</p>
					<p className="text-muted-foreground text-xs">
						{input.deleted
							? "Remove this deleted Space from your list. Other members can still read its history."
							: "Remove your current profile from this space."}
					</p>
				</div>
				<Button
					disabled={input.isSpaceMutationPending}
					onClick={() => input.onConfirmingChange(true)}
					type="button"
					variant="destructive"
				>
					{input.deleted ? "Remove from my list" : "Leave space"}
				</Button>
			</div>

			{input.isConfirming ? (
				<div className="mt-3 space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
					<div className="space-y-1">
						<p className="font-medium text-sm">
							{input.deleted
								? "Remove this Space from your list?"
								: "Leave this space?"}
						</p>
						<p className="text-muted-foreground text-xs">
							You will stop seeing this space in your active list for the
							current profile.
						</p>
					</div>
					{input.action.errorMessage ? (
						<p className="text-destructive text-xs" role="alert">
							{input.action.errorMessage}
						</p>
					) : null}
					<div className="flex justify-end gap-2">
						<Button
							disabled={input.isSpaceMutationPending}
							onClick={() => input.onConfirmingChange(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={input.isSpaceMutationPending}
							onClick={async () => {
								await input.action?.onLeave();
							}}
							type="button"
							variant="destructive"
						>
							{input.action.isPending ? pendingLabel : confirmLabel}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}

function buildSpaceCliJoinCommand(spaceId: string): string {
	return formatWebCliCommand(`openmeld space join ${spaceId}`);
}

function SpaceInfoDeleteSection(input: {
	deleteSpaceErrorMessage: string | null;
	isDeleteSpacePending: boolean;
	isSpaceMutationPending: boolean;
	onDeleteSpace: () => Promise<void> | void;
	onStartDeleteConfirmation: () => void;
}) {
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
	const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
	const deleteConfirmationInputId = useId();
	const deleteConfirmationInputRef = useRef<HTMLInputElement>(null);
	const deleteConfirmationPanelRef = useRef<HTMLDivElement>(null);
	const isDeleteConfirmationAccepted =
		deleteConfirmationText.trim() === "DELETE";

	useEffect(() => {
		if (!isConfirmingDelete) {
			return;
		}

		const confirmationPanel = deleteConfirmationPanelRef.current;
		const confirmationInput = deleteConfirmationInputRef.current;
		if (!(confirmationPanel && confirmationInput)) {
			return;
		}

		const prefersReducedMotion =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		confirmationPanel.scrollIntoView({
			behavior: prefersReducedMotion ? "auto" : "smooth",
			block: "nearest",
		});
		confirmationInput.focus({ preventScroll: true });
	}, [isConfirmingDelete]);

	return (
		<div className="min-w-0 border-border/60 border-t pt-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="font-medium text-sm">Delete space</p>
					<p className="text-muted-foreground text-xs">
						Stop new messages and Agent work. Members can still read and search
						the history.
					</p>
				</div>
				<Button
					disabled={input.isSpaceMutationPending}
					onClick={() => {
						input.onStartDeleteConfirmation();
						setIsConfirmingDelete(true);
						setDeleteConfirmationText("");
					}}
					type="button"
					variant="destructive"
				>
					Delete space
				</Button>
			</div>

			{isConfirmingDelete ? (
				<div
					className="mt-3 space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3"
					ref={deleteConfirmationPanelRef}
				>
					<div className="space-y-1">
						<p className="font-medium text-sm">Delete this Space?</p>
						<p className="text-muted-foreground text-xs">
							Members can still read and search past messages. No one can send
							new messages or wake Agents in this Space.
						</p>
						<p className="text-muted-foreground text-xs">
							This Space will remain in members’ lists as Deleted. Members can
							remove it from their own list afterward.
						</p>
					</div>
					<label
						className="block space-y-1.5"
						htmlFor={deleteConfirmationInputId}
					>
						<span className="text-muted-foreground text-xs">
							Type DELETE to confirm
						</span>
						<Input
							autoComplete="off"
							id={deleteConfirmationInputId}
							onChange={(event) => {
								setDeleteConfirmationText(event.target.value);
							}}
							ref={deleteConfirmationInputRef}
							value={deleteConfirmationText}
						/>
					</label>
					{input.deleteSpaceErrorMessage ? (
						<p className="text-destructive text-xs" role="alert">
							{input.deleteSpaceErrorMessage}
						</p>
					) : null}
					<div className="flex justify-end gap-2">
						<Button
							disabled={input.isSpaceMutationPending}
							onClick={() => {
								setIsConfirmingDelete(false);
								setDeleteConfirmationText("");
							}}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={
								input.isSpaceMutationPending || !isDeleteConfirmationAccepted
							}
							onClick={async () => {
								await input.onDeleteSpace();
							}}
							type="button"
							variant="destructive"
						>
							{input.isDeleteSpacePending ? "Deleting..." : "Delete Space"}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}

function SpaceInfoReadOnlyField(input: { label: string; value: string }) {
	return (
		<div className="min-w-0 space-y-1">
			<p className="text-muted-foreground text-xs">{input.label}</p>
			<p className="break-words text-xs [overflow-wrap:anywhere]">
				{input.value}
			</p>
		</div>
	);
}

function SpaceInfoCopyField(input: {
	ariaLabel: string;
	label: string;
	successMessage: string;
	value: string;
}) {
	return (
		<div className="min-w-0 space-y-1">
			<p className="text-muted-foreground text-xs">{input.label}</p>
			<button
				aria-label={input.ariaLabel}
				className="group grid w-full min-w-0 max-w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-3 overflow-hidden bg-surface-2 p-2 text-left text-xs transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
				onClick={async () => {
					await copyToClipboard({
						successMessage: input.successMessage,
						value: input.value,
					});
				}}
				type="button"
			>
				<span className="min-w-0 whitespace-pre-wrap break-all font-mono [overflow-wrap:anywhere]">
					{input.value}
				</span>
				<CopyIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
			</button>
		</div>
	);
}

async function copyToClipboard(input: {
	successMessage: string;
	value: string;
}) {
	if (await copyTextToClipboard(input.value)) {
		toast.success(input.successMessage);
		return;
	}

	toast.error(
		"OpenMeld could not copy this automatically. Select the text and copy it manually."
	);
}
