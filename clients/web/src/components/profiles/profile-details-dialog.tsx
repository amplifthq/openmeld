"use client";

import { formatProfileKind } from "@openmeld/agent-profile";
import type {
	ProfileDetailsField,
	ProfileDetailsRecoveryAction,
	ProfileDetailsSection,
	ProfileDetailsSectionId,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CaretDownIcon,
	ChatCircleTextIcon,
	CopyIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { ProfileDetailsCurrentSession } from "#/components/profiles/profile-details-current-session";
import { ProfileDetailsRecoveryActionButton } from "#/components/profiles/profile-details-recovery-action-button";
import { copyTextToClipboard } from "#/lib/clipboard";

const AGENT_WORKSPACE_TECHNICAL_SECTION_IDS: ReadonlySet<ProfileDetailsSectionId> =
	new Set(["connection", "agent_controller_permission_mode", "advanced"]);

export function ProfileDetailsDialog(input: {
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	details: ProfileDetailsSnapshot;
	isDirectMessagePending?: boolean;
	isRecoveryActionPending?: boolean;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	onOpenDirectMessage?: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="flex max-h-[min(42rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-xl">
				<DialogHeader className="shrink-0 pr-8">
					<DialogTitle>About profile</DialogTitle>
					<DialogDescription>
						Profile details from OpenMeld, scoped to what this viewer can
						access.
					</DialogDescription>
				</DialogHeader>

				<ProfileDetailsContent
					className="min-h-0 flex-1 overflow-y-auto pr-1"
					currentSession={input.currentSession}
					details={input.details}
					isDirectMessagePending={input.isDirectMessagePending}
					isRecoveryActionPending={input.isRecoveryActionPending}
					onOpenDirectMessage={input.onOpenDirectMessage}
					onRecoveryAction={input.onRecoveryAction}
					testId="profile-details-dialog-scroll-area"
				/>
			</DialogContent>
		</Dialog>
	);
}

export function ProfileDetailsContent(input: {
	className?: string;
	collapseAgentTechnicalDetails?: boolean;
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	details: ProfileDetailsSnapshot;
	excludedSectionIds?: readonly ProfileDetailsSectionId[];
	isDirectMessagePending?: boolean;
	isRecoveryActionPending?: boolean;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	onOpenDirectMessage?: () => void;
	showSummary?: boolean;
	testId?: string;
}) {
	const excludedSectionIds = new Set(input.excludedSectionIds ?? []);
	const visibleSections = input.details.sections.filter(
		(section) => !excludedSectionIds.has(section.id)
	);
	const technicalSections = input.collapseAgentTechnicalDetails
		? visibleSections.filter((section) =>
				AGENT_WORKSPACE_TECHNICAL_SECTION_IDS.has(section.id)
			)
		: [];
	const primarySections = input.collapseAgentTechnicalDetails
		? visibleSections.filter(
				(section) => !AGENT_WORKSPACE_TECHNICAL_SECTION_IDS.has(section.id)
			)
		: visibleSections;
	const showCollapsedTechnicalDetails =
		input.collapseAgentTechnicalDetails === true &&
		(Boolean(input.currentSession) || technicalSections.length > 0);
	return (
		<div className={cn("min-w-0", input.className)} data-testid={input.testId}>
			{input.showSummary === false ? null : (
				<div className="flex min-w-0 items-start justify-between gap-3">
					<div className="min-w-0">
						<p className="break-words font-medium text-sm">
							{input.details.profileName}
						</p>
						<p className="text-muted-foreground text-xs">
							{formatProfileKind(input.details.profileKind)}
						</p>
					</div>
					{input.onOpenDirectMessage ? (
						<Button
							className="shrink-0"
							disabled={input.isDirectMessagePending === true}
							onClick={input.onOpenDirectMessage}
							size="sm"
							type="button"
							variant="outline"
						>
							<ChatCircleTextIcon data-icon="inline-start" />
							Direct Message
						</Button>
					) : null}
				</div>
			)}
			{input.currentSession && !input.collapseAgentTechnicalDetails ? (
				<ProfileDetailsCurrentSession
					className="mt-5"
					currentSession={input.currentSession}
				/>
			) : null}

			<div className="mt-5 min-w-0 space-y-5">
				{primarySections.map((section) => (
					<ProfileDetailsSectionView
						isRecoveryActionPending={input.isRecoveryActionPending === true}
						key={section.id}
						onRecoveryAction={input.onRecoveryAction}
						section={section}
					/>
				))}
				{showCollapsedTechnicalDetails ? (
					<details
						className="group min-w-0 overflow-hidden rounded-md border border-border"
						data-testid="profile-technical-details"
					>
						<summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 font-medium text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
							<span className="min-w-0 flex-1">Technical details</span>
							<CaretDownIcon
								aria-hidden="true"
								className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
							/>
						</summary>
						<div className="min-w-0 space-y-5 border-border border-t px-3 py-3">
							{input.currentSession ? (
								<ProfileDetailsCurrentSession
									currentSession={input.currentSession}
								/>
							) : null}
							{technicalSections.map((section) => (
								<ProfileDetailsSectionView
									isRecoveryActionPending={
										input.isRecoveryActionPending === true
									}
									key={section.id}
									onRecoveryAction={input.onRecoveryAction}
									section={section}
								/>
							))}
						</div>
					</details>
				) : null}
			</div>
		</div>
	);
}

function ProfileDetailsSectionView(input: {
	isRecoveryActionPending: boolean;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	section: ProfileDetailsSection;
}) {
	const recoveryAction = input.section.recoveryAction;
	return (
		<section className="min-w-0 space-y-2">
			<h3 className="font-medium text-muted-foreground text-xs">
				{input.section.title}
			</h3>
			<div className="min-w-0 divide-y divide-border overflow-hidden rounded-md border border-border">
				{input.section.rows.map((row) => (
					<ProfileDetailsFieldRow
						key={`${input.section.id}:${row.id}`}
						row={row}
					/>
				))}
			</div>
			{recoveryAction && input.onRecoveryAction ? (
				<ProfileDetailsRecoveryActionButton
					isPending={input.isRecoveryActionPending}
					onRecoveryAction={input.onRecoveryAction}
					recoveryAction={recoveryAction}
				/>
			) : null}
		</section>
	);
}

function ProfileDetailsFieldRow(input: { row: ProfileDetailsField }) {
	const value = (
		<span
			className={cn(
				"min-w-0 whitespace-pre-wrap break-all text-xs [overflow-wrap:anywhere]",
				input.row.valueKind === "identifier" || input.row.valueKind === "path"
					? "font-mono"
					: null
			)}
		>
			{input.row.value}
		</span>
	);

	if (input.row.copy) {
		return (
			<button
				aria-label={input.row.copy.label}
				className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-inset"
				onClick={async () => {
					await copyDetailsValue({
						successMessage:
							input.row.copy?.successMessage ?? `${input.row.label} copied.`,
						value: input.row.value,
					});
				}}
				type="button"
			>
				<span className="min-w-0 space-y-1">
					<span className="block text-muted-foreground text-xs">
						{input.row.label}
					</span>
					{value}
				</span>
				<CopyIcon className="mt-5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
			</button>
		);
	}

	return (
		<div className="min-w-0 space-y-1 px-3 py-2">
			<p className="text-muted-foreground text-xs">{input.row.label}</p>
			{value}
		</div>
	);
}

async function copyDetailsValue(input: {
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
