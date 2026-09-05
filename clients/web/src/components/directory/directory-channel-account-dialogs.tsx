"use client";

import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { DirectoryIdentityAccount } from "#/components/directory/directory-human-profile-model";
import { DirectoryIdentityAccountSummary } from "#/components/directory/directory-human-profile-presentation";
import { DirectoryIdentityAccountActionLink } from "#/components/directory/directory-identity-account-action-link";

export function ConnectChannelAccountDialog(input: {
	accounts: readonly DirectoryIdentityAccount[] | null;
	onOpenChange: (open: boolean) => void;
	onRequestSetup: (
		provider: DirectoryIdentityAccount["provider"]
	) => Promise<void>;
}) {
	const [copied, setCopied] = useState(false);
	const [pendingProvider, setPendingProvider] = useState<
		DirectoryIdentityAccount["provider"] | null
	>(null);
	const account = input.accounts?.length === 1 ? input.accounts[0] : null;
	const providerLabel = account?.providerLabel ?? "Channel";
	const requestText = `Connect this ${providerLabel} account to my OpenMeld profile`;
	const isProviderProof = account?.action?.kind === "connect_via_center_agent";

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					setCopied(false);
					setPendingProvider(null);
				}
				input.onOpenChange(open);
			}}
			open={input.accounts !== null}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{input.accounts && input.accounts.length > 1
							? "Connect a Channel account"
							: (account?.action?.label ??
								`Connect your ${providerLabel} account`)}
					</DialogTitle>
					<DialogDescription>
						{isProviderProof
							? `Open ${providerLabel}, send the Center Agent the message below, then use the private connection button it sends you. You will review both accounts before anything changes.`
							: "Choose the Channel account to connect to this person."}
					</DialogDescription>
				</DialogHeader>
				{isProviderProof ? (
					<div className="rounded-md border border-border bg-muted/30 px-3 py-2 font-medium text-sm">
						{requestText}
					</div>
				) : (
					<div className="space-y-2">
						{input.accounts?.map((candidate) => (
							<ChannelSetupChoice
								account={candidate}
								key={candidate.provider}
								onRequestSetup={async () => {
									setPendingProvider(candidate.provider);
									try {
										await input.onRequestSetup(candidate.provider);
										input.onOpenChange(false);
									} finally {
										setPendingProvider(null);
									}
								}}
								pending={pendingProvider === candidate.provider}
							/>
						))}
					</div>
				)}
				{isProviderProof ? (
					<DialogFooter className="sm:justify-between">
						{account?.channelsPath ? (
							<Link
								className={buttonVariants({ size: "sm", variant: "ghost" })}
								to={account.channelsPath}
							>
								View Channels
							</Link>
						) : null}
						<Button
							onClick={() => {
								navigator.clipboard
									.writeText(requestText)
									.then(() => setCopied(true))
									.catch((error: unknown) => {
										console.error(
											"Could not copy the Message Channel account connection request.",
											error
										);
									});
							}}
							size="sm"
							type="button"
						>
							{copied ? "Copied" : "Copy message"}
						</Button>
					</DialogFooter>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function ChannelSetupChoice(input: {
	account: DirectoryIdentityAccount;
	onRequestSetup: () => Promise<void>;
	pending: boolean;
}) {
	const action = input.account.action;
	if (!action) {
		return null;
	}
	const content = (
		<>
			<DirectoryIdentityAccountSummary
				account={input.account}
				context="detail"
			/>
			<span className="ml-auto font-medium text-sm">{action.label}</span>
		</>
	);
	const className =
		"flex min-h-12 w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40";
	if (action.path) {
		return (
			<DirectoryIdentityAccountActionLink
				actionKind={action.kind}
				className={className}
				path={action.path}
			>
				{content}
			</DirectoryIdentityAccountActionLink>
		);
	}
	if (action.kind === "ask_admin") {
		return (
			<button
				className={className}
				disabled={input.pending}
				onClick={() => {
					input.onRequestSetup().catch(() => undefined);
				}}
				type="button"
			>
				{content}
			</button>
		);
	}
	return <div className={className}>{content}</div>;
}

export function ManageChannelAccountDialog(input: {
	account: DirectoryIdentityAccount | null;
	onDisconnect: () => void;
	onOpenChange: (open: boolean) => void;
	profileName: string;
}) {
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.account !== null}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						Manage {input.account?.providerLabel ?? "Channel"} account
					</DialogTitle>
					<DialogDescription>
						{input.account
							? `Disconnect this account from ${input.profileName}. The Organization's ${input.account.providerLabel} connection will stay active.`
							: `Disconnect this account from ${input.profileName}. The Organization's Channel connection will stay active.`}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						onClick={input.onDisconnect}
						type="button"
						variant="destructive"
					>
						Disconnect account
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
