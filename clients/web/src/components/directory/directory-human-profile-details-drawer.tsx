"use client";

import type { ProfileDetailsField } from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ChatCircleTextIcon,
	CopyIcon,
	FileTextIcon,
	PencilSimpleIcon,
	UserFocusIcon,
	XIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { DirectoryHumanProfileAvatar } from "#/components/directory/directory-human-profile-avatar";
import {
	formatDirectoryDate,
	resolveDirectoryEmailLabel,
	resolveDirectoryHumanProfileActivityLabel,
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
import { HumanProfileNameEditor } from "#/components/profiles/human-profile-name-editor";
import { copyTextToClipboard } from "#/lib/clipboard";

export type DirectoryHumanProfileResearchAction = {
	description: string;
	disabled: boolean;
	label: string;
	onSelect: () => void;
};

export function DirectoryHumanProfileDetailsDrawer(input: {
	activityNowMs: number;
	directMessageIsPending: boolean;
	editing: boolean;
	member: DirectoryHumanProfileRow;
	onConnectAccount: (account: DirectoryIdentityAccount) => void;
	onEditingChange: (editing: boolean) => void;
	onManageAccount: (account: DirectoryIdentityAccount) => void;
	onOpenChange: (open: boolean) => void;
	onOpenDirectMessage: () => void;
	open: boolean;
	researchAction: DirectoryHumanProfileResearchAction | null;
}) {
	const canOpenDirectMessage =
		input.member.profileStatus === "active" && !input.member.isCurrentUser;
	return (
		<Drawer.Root
			autoFocus
			direction="right"
			onOpenChange={input.onOpenChange}
			open={input.open}
		>
			<Drawer.Portal>
				<Drawer.Overlay className="fixed inset-0 z-40 bg-background/55 backdrop-blur-[2px] motion-reduce:transition-none" />
				<Drawer.Content
					className="fixed top-0 right-0 bottom-0 z-50 flex border-border border-l bg-background shadow-2xl outline-none motion-reduce:transition-none"
					data-testid="human-profile-details-drawer"
					style={
						{
							"--initial-transform": "calc(100% + 1px)",
							width: "min(32rem, 100vw)",
						} as CSSProperties
					}
				>
					<div className="flex min-h-0 w-full flex-col">
						<header className="flex shrink-0 items-center justify-between gap-4 border-border border-b px-5 py-4">
							<div className="min-w-0">
								<Drawer.Title className="font-medium text-base">
									Profile
								</Drawer.Title>
								<Drawer.Description className="sr-only">
									Member identity, access, and account details.
								</Drawer.Description>
							</div>
							<Drawer.Close asChild>
								<Button
									aria-label="Close profile"
									size="icon"
									type="button"
									variant="ghost"
								>
									<XIcon aria-hidden="true" />
								</Button>
							</Drawer.Close>
						</header>

						<div className="min-h-0 flex-1 overflow-y-auto">
							<div className="space-y-6 px-5 py-6">
								<ProfileHero
									activityNowMs={input.activityNowMs}
									editing={input.editing}
									member={input.member}
									onEditingChange={input.onEditingChange}
								/>
								<ProfileActions
									canOpenDirectMessage={canOpenDirectMessage}
									directMessageIsPending={input.directMessageIsPending}
									onOpenDirectMessage={input.onOpenDirectMessage}
									researchAction={input.researchAction}
								/>

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

								<DetailSection title="Work access">
									<DirectoryComputerSummary
										member={input.member}
										size="detail"
									/>
								</DetailSection>

								<ConnectedIdentities
									accounts={input.member.identityAccounts}
									onConnectAccount={input.onConnectAccount}
									onManageAccount={input.onManageAccount}
								/>

								<ProfileReportSection member={input.member} />

								{input.member.details?.sections.map((section) => (
									<DetailSection key={section.id} title={section.title}>
										{section.rows.map((row) => (
											<ProfileDetailRow
												key={`${section.id}:${row.id}`}
												row={row}
											/>
										))}
									</DetailSection>
								))}
							</div>
						</div>
					</div>
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
	);
}

function ProfileActions(input: {
	canOpenDirectMessage: boolean;
	directMessageIsPending: boolean;
	onOpenDirectMessage: () => void;
	researchAction: DirectoryHumanProfileResearchAction | null;
}) {
	if (!(input.canOpenDirectMessage || input.researchAction)) {
		return null;
	}
	const hasTwoActions =
		input.canOpenDirectMessage && Boolean(input.researchAction);
	return (
		<div
			className={cn(
				"grid gap-2",
				hasTwoActions ? "sm:grid-cols-2" : "grid-cols-1"
			)}
			data-testid="human-profile-primary-actions"
		>
			{input.canOpenDirectMessage ? (
				<Button
					className="w-full"
					disabled={input.directMessageIsPending}
					onClick={input.onOpenDirectMessage}
					size="lg"
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
					className="w-full"
					disabled={input.researchAction.disabled}
					onClick={input.researchAction.onSelect}
					size="lg"
					type="button"
				>
					<UserFocusIcon aria-hidden="true" data-icon="inline-start" />
					{input.researchAction.label}
				</Button>
			) : null}
		</div>
	);
}

function ProfileHero(input: {
	activityNowMs: number;
	editing: boolean;
	member: DirectoryHumanProfileRow;
	onEditingChange: (editing: boolean) => void;
}) {
	const activityLabel = resolveDirectoryHumanProfileActivityLabel({
		lastActiveAt: input.member.lastActiveAt,
		nowMs: input.activityNowMs,
		profileStatus: input.member.profileStatus,
	});
	return (
		<div className="flex min-w-0 items-start gap-4">
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
						{input.member.canEdit ? (
							<Button
								className="shrink-0"
								onClick={() => input.onEditingChange(true)}
								size="sm"
								type="button"
								variant="ghost"
							>
								<PencilSimpleIcon aria-hidden="true" />
								Edit profile
							</Button>
						) : null}
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
						{activityLabel}
					</p>
				) : null}
			</div>
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
			<Link
				className={buttonVariants({ size: "sm", variant: "outline" })}
				to={action.path}
			>
				{action.label}
			</Link>
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

function ProfileReportSection(input: { member: DirectoryHumanProfileRow }) {
	const report = input.member.profileReport;
	let content: React.ReactNode;
	if (report.state === "available") {
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
