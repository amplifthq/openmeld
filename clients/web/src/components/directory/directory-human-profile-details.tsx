"use client";

import type { ProfileDetailsField } from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ChatCircleTextIcon,
	CopyIcon,
	FileTextIcon,
	PencilSimpleIcon,
	UserFocusIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { DirectoryHumanProfileAvatar } from "#/components/directory/directory-human-profile-avatar";
import {
	formatDirectoryDate,
	resolveDirectoryEmailLabel,
	resolveDirectoryHumanProfileActivityLabel,
	resolveDirectoryHumanProfileActivityTooltipLabel,
	resolveDirectoryRoleLabel,
} from "#/components/directory/directory-human-profile-format";
import type {
	DirectoryHumanProfileRow,
	DirectoryIdentityAccount,
} from "#/components/directory/directory-human-profile-model";
import {
	DirectoryAgentProfilesSummary,
	DirectoryComputerSummary,
	DirectoryIdentityAccountSummary,
} from "#/components/directory/directory-human-profile-presentation";
import { DirectoryHumanProfileRoleBadge } from "#/components/directory/directory-human-profile-role-badge";
import { DirectoryIdentityAccountActionLink } from "#/components/directory/directory-identity-account-action-link";
import { HumanProfileNameEditor } from "#/components/profiles/human-profile-name-editor";
import { copyTextToClipboard } from "#/lib/clipboard";

export type DirectoryHumanProfileResearchAction = {
	description: string;
	disabled: boolean;
	errorMessage: string | null;
	label: string;
	onSelect: () => void;
};

export type DirectoryHumanProfileDetailsProps = {
	activityNowMs: number;
	computersContent?: ReactNode;
	directMessageIsPending: boolean;
	editing: boolean;
	member: DirectoryHumanProfileRow;
	onConnectAccount: (account: DirectoryIdentityAccount) => void;
	onEditingChange: (editing: boolean) => void;
	onManageAccount: (account: DirectoryIdentityAccount) => void;
	onOpenDirectMessage: () => void;
	onRetryProfileReports: () => void;
	profileReportsAreRetrying: boolean;
	profileReportsErrorMessage: string | null;
	researchAction: DirectoryHumanProfileResearchAction | null;
};

export function DirectoryHumanProfileDetails(
	input: DirectoryHumanProfileDetailsProps
) {
	const canOpenDirectMessage =
		input.member.profileStatus === "active" && !input.member.isCurrentUser;
	return (
		<div
			className="@container/profile-detail mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
			data-testid="human-profile-details"
		>
			<ProfileHero
				activityNowMs={input.activityNowMs}
				canOpenDirectMessage={canOpenDirectMessage}
				directMessageIsPending={input.directMessageIsPending}
				editing={input.editing}
				member={input.member}
				onEditingChange={input.onEditingChange}
				onOpenDirectMessage={input.onOpenDirectMessage}
				researchAction={input.researchAction}
			/>
			{input.member.notice ? (
				<output className="block rounded-md border border-border bg-muted/35 px-4 py-3 text-muted-foreground text-sm">
					{input.member.notice}
				</output>
			) : null}

			<DetailSection title="Member account">
				<DetailRow
					label="Email"
					value={resolveDirectoryEmailLabel(input.member.email)}
				/>
				{input.member.role === null ? null : (
					<DetailRow
						label="Organization role"
						value={resolveDirectoryRoleLabel(input.member.role)}
					/>
				)}
				<DetailRow
					label="Joined"
					value={formatDirectoryDate(input.member.joinedAt)}
				/>
			</DetailSection>

			<DetailSection title="Agent Profiles">
				<DirectoryAgentProfilesSummary
					ownerName={input.member.name}
					path={input.member.agentProfilesPath}
					profiles={input.member.agentProfiles}
				/>
			</DetailSection>

			<DetailSection title="Computers">
				{input.computersContent ?? (
					<DirectoryComputerSummary member={input.member} size="detail" />
				)}
			</DetailSection>

			<ConnectedIdentities
				accounts={input.member.identityAccounts}
				onConnectAccount={input.onConnectAccount}
				onManageAccount={input.onManageAccount}
			/>

			<ProfileReportSection
				errorMessage={input.profileReportsErrorMessage}
				isRetrying={input.profileReportsAreRetrying}
				member={input.member}
				onRetry={input.onRetryProfileReports}
			/>

			{input.member.details?.sections.map((section) => (
				<DetailSection key={section.id} title={section.title}>
					{section.rows.map((row) => (
						<ProfileDetailRow key={`${section.id}:${row.id}`} row={row} />
					))}
				</DetailSection>
			))}
		</div>
	);
}

function ProfileActions(input: {
	canEdit: boolean;
	canOpenDirectMessage: boolean;
	directMessageIsPending: boolean;
	onEdit: () => void;
	onOpenDirectMessage: () => void;
	researchAction: DirectoryHumanProfileResearchAction | null;
}) {
	if (!(input.canEdit || input.canOpenDirectMessage || input.researchAction)) {
		return null;
	}
	return (
		<div
			className="flex max-w-full shrink-0 flex-col items-end gap-2 self-end"
			data-testid="human-profile-header-actions"
		>
			<div className="flex max-w-full flex-wrap items-center justify-end gap-2">
				{input.canOpenDirectMessage ? (
					<Button
						disabled={input.directMessageIsPending}
						onClick={input.onOpenDirectMessage}
						size="sm"
						type="button"
						variant="outline"
					>
						<ChatCircleTextIcon aria-hidden="true" data-icon="inline-start" />
						Direct Message
					</Button>
				) : null}
				{input.researchAction ? (
					<Button
						aria-description={input.researchAction.description}
						aria-label={input.researchAction.label}
						disabled={input.researchAction.disabled}
						onClick={input.researchAction.onSelect}
						size="sm"
						type="button"
						variant="outline"
					>
						<UserFocusIcon aria-hidden="true" data-icon="inline-start" />
						{input.researchAction.label}
					</Button>
				) : null}
				{input.canEdit ? (
					<Button
						onClick={input.onEdit}
						size="sm"
						type="button"
						variant="outline"
					>
						<PencilSimpleIcon aria-hidden="true" data-icon="inline-start" />
						Edit profile
					</Button>
				) : null}
			</div>
			{input.researchAction?.errorMessage ? (
				<p
					className="max-w-md text-right text-destructive text-xs"
					role="alert"
				>
					{input.researchAction.errorMessage}
				</p>
			) : null}
		</div>
	);
}

function ProfileHero(input: {
	activityNowMs: number;
	canOpenDirectMessage: boolean;
	directMessageIsPending: boolean;
	editing: boolean;
	member: DirectoryHumanProfileRow;
	onEditingChange: (editing: boolean) => void;
	onOpenDirectMessage: () => void;
	researchAction: DirectoryHumanProfileResearchAction | null;
}) {
	const activityLabel = resolveDirectoryHumanProfileActivityLabel({
		lastActiveAt: input.member.lastActiveAt,
		nowMs: input.activityNowMs,
		profileStatus: input.member.profileStatus,
	});
	const activityTooltipLabel = resolveDirectoryHumanProfileActivityTooltipLabel(
		{
			lastActiveAt: input.member.lastActiveAt,
			nowMs: input.activityNowMs,
			profileStatus: input.member.profileStatus,
		}
	);
	return (
		<div
			className="flex min-w-0 @[42rem]/profile-detail:flex-row flex-col @[42rem]/profile-detail:items-start gap-4"
			data-testid="human-profile-hero"
		>
			<div className="flex min-w-0 flex-1 items-start gap-4">
				<DirectoryHumanProfileAvatar context="detail" member={input.member} />
				<div className="min-w-0 flex-1 pt-1">
					{input.editing ? (
						<HumanProfileNameEditor
							onCancel={() => input.onEditingChange(false)}
							onSaved={() => input.onEditingChange(false)}
							profileName={input.member.name}
						/>
					) : (
						<div className="flex min-w-0 items-start gap-2">
							<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
								<h2 className="select-text break-words font-semibold text-xl leading-7">
									{input.member.name}
									{input.member.isCurrentUser ? " (you)" : ""}
								</h2>
								<DirectoryHumanProfileRoleBadge role={input.member.role} />
							</div>
						</div>
					)}
					<p className="mt-1 select-text break-all text-muted-foreground text-sm">
						{resolveDirectoryEmailLabel(input.member.email)}
					</p>
					{activityLabel ? (
						<p
							className={cn(
								"mt-3 select-text text-sm",
								input.member.profileStatus === "disabled"
									? "text-destructive"
									: "text-muted-foreground"
							)}
						>
							{activityTooltipLabel ? (
								<Tooltip>
									<TooltipTrigger render={<span />}>
										{activityLabel}
									</TooltipTrigger>
									<TooltipContent side="top">
										{activityTooltipLabel}
									</TooltipContent>
								</Tooltip>
							) : (
								activityLabel
							)}
						</p>
					) : null}
				</div>
			</div>
			<ProfileActions
				canEdit={!input.editing && input.member.canEdit}
				canOpenDirectMessage={input.canOpenDirectMessage}
				directMessageIsPending={input.directMessageIsPending}
				onEdit={() => input.onEditingChange(true)}
				onOpenDirectMessage={input.onOpenDirectMessage}
				researchAction={input.researchAction}
			/>
		</div>
	);
}

function ConnectedIdentities(input: {
	accounts: readonly DirectoryIdentityAccount[];
	onConnectAccount: (account: DirectoryIdentityAccount) => void;
	onManageAccount: (account: DirectoryIdentityAccount) => void;
}) {
	if (input.accounts.length === 0) {
		return null;
	}
	return (
		<section className="space-y-2">
			<h3 className="font-medium text-muted-foreground text-xs">
				Connected Channels
			</h3>
			<div className="min-w-0 divide-y divide-border overflow-hidden rounded-md border border-border">
				{input.accounts.map((account) => (
					<div
						className="flex min-w-0 items-center gap-3 px-4 py-3"
						key={account.provider}
					>
						<div className="min-w-0 flex-1">
							<DirectoryIdentityAccountSummary
								account={account}
								context="detail"
							/>
						</div>
						<ConnectedIdentityAction
							account={account}
							onConnectAccount={input.onConnectAccount}
						/>
						{account.id && account.canDisconnect ? (
							<Button
								onClick={() => input.onManageAccount(account)}
								size="sm"
								type="button"
								variant="outline"
							>
								Manage
							</Button>
						) : null}
					</div>
				))}
			</div>
		</section>
	);
}

function ConnectedIdentityAction(input: {
	account: DirectoryIdentityAccount;
	onConnectAccount: (account: DirectoryIdentityAccount) => void;
}) {
	const action = input.account.action;
	if (!action) {
		return null;
	}
	if (action.path && action.kind !== "connect_via_center_agent") {
		return (
			<DirectoryIdentityAccountActionLink
				actionKind={action.kind}
				className={buttonVariants({ size: "sm", variant: "outline" })}
				path={action.path}
			>
				{action.label}
			</DirectoryIdentityAccountActionLink>
		);
	}
	return (
		<Button
			onClick={() => input.onConnectAccount(input.account)}
			size="sm"
			type="button"
			variant="outline"
		>
			{action.label}
		</Button>
	);
}

function ProfileReportSection(input: {
	errorMessage: string | null;
	isRetrying: boolean;
	member: DirectoryHumanProfileRow;
	onRetry: () => void;
}) {
	const report = input.member.profileReport;
	let content: React.ReactNode;
	if (input.errorMessage) {
		content = (
			<div className="flex min-w-0 items-center gap-3 px-4 py-3" role="alert">
				<p className="min-w-0 flex-1 text-destructive text-sm">
					{input.errorMessage}
				</p>
				<Button
					disabled={input.isRetrying}
					onClick={input.onRetry}
					size="sm"
					type="button"
					variant="outline"
				>
					{input.isRetrying ? "Retrying…" : "Retry"}
				</Button>
			</div>
		);
	} else if (report.state === "available") {
		content = (
			<div className="flex min-w-0 items-center gap-3 px-4 py-3">
				<div className="min-w-0 flex-1 space-y-1">
					<p className="font-medium text-sm">Latest Profile Report</p>
					<p className="text-muted-foreground text-xs">
						{report.hasDraft
							? "Updates are ready to review and save."
							: "Ready to open."}
					</p>
				</div>
				<Link
					aria-label={`Open ${input.member.name}'s Profile Report`}
					className={cn(
						buttonVariants({ size: "sm", variant: "outline" }),
						"shrink-0"
					)}
					to={report.path}
				>
					<FileTextIcon aria-hidden="true" data-icon="inline-start" />
					Open report
				</Link>
			</div>
		);
	} else {
		content = (
			<p className="px-4 py-3 text-muted-foreground text-sm">
				{report.state === "missing"
					? "No Profile Report yet"
					: "Profile Report status unavailable"}
			</p>
		);
	}

	return <DetailSection title="Profile Report">{content}</DetailSection>;
}

function DetailSection(input: { children: React.ReactNode; title: string }) {
	return (
		<section className="space-y-2">
			<h3 className="font-medium text-muted-foreground text-xs">
				{input.title}
			</h3>
			<div className="min-w-0 divide-y divide-border overflow-hidden rounded-md border border-border">
				{input.children}
			</div>
		</section>
	);
}

function DetailRow(input: { label: string; value: string }) {
	return (
		<div className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)] gap-3 px-4 py-3 text-sm">
			<p className="text-muted-foreground">{input.label}</p>
			<p className="min-w-0 select-text break-words">{input.value}</p>
		</div>
	);
}

function ProfileDetailRow(input: { row: ProfileDetailsField }) {
	const value = (
		<span
			className={cn(
				"min-w-0 select-text whitespace-pre-wrap break-all text-xs [overflow-wrap:anywhere]",
				input.row.valueKind === "identifier" || input.row.valueKind === "path"
					? "font-mono"
					: null
			)}
		>
			{input.row.value}
		</span>
	);
	if (!input.row.copy) {
		return (
			<div className="min-w-0 space-y-1 px-4 py-3">
				<p className="text-muted-foreground text-xs">{input.row.label}</p>
				{value}
			</div>
		);
	}
	return (
		<button
			aria-label={input.row.copy.label}
			className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-inset"
			onClick={async () => {
				if (await copyTextToClipboard(input.row.value)) {
					toast.success(
						input.row.copy?.successMessage ?? `${input.row.label} copied.`
					);
					return;
				}
				toast.error(
					"OpenMeld could not copy this automatically. Select the text and copy it manually."
				);
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
