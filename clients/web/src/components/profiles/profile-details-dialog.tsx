"use client";

import { formatProfileKind } from "@openmeld/agent-profile";
import type {
	ProfileDetailsField,
	ProfileDetailsSection,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowSquareOutIcon,
	ChatCircleTextIcon,
	CopyIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { copyTextToClipboard } from "#/lib/clipboard";

export function ProfileDetailsDialog(input: {
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	details: ProfileDetailsSnapshot;
	isDirectMessagePending?: boolean;
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
					onOpenDirectMessage={input.onOpenDirectMessage}
					testId="profile-details-dialog-scroll-area"
				/>
			</DialogContent>
		</Dialog>
	);
}

export function ProfileDetailsContent(input: {
	className?: string;
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	details: ProfileDetailsSnapshot;
	isDirectMessagePending?: boolean;
	onOpenDirectMessage?: () => void;
	showSummary?: boolean;
	testId?: string;
}) {
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
			{input.currentSession ? (
				<div className="mt-5 flex min-w-0 items-start justify-between gap-3 rounded-md border border-border px-3 py-3">
					<div className="min-w-0 space-y-1">
						<p className="text-muted-foreground text-xs">Current Session</p>
						<p className="break-words font-medium text-sm">
							{input.currentSession.title}
						</p>
						<p className="break-all font-mono text-muted-foreground text-xs">
							{input.currentSession.nativeSessionId}
						</p>
					</div>
					<Link
						className={cn(
							buttonVariants({ size: "sm", variant: "outline" }),
							"shrink-0"
						)}
						to={input.currentSession.href}
					>
						<ArrowSquareOutIcon data-icon="inline-start" />
						View Session
					</Link>
				</div>
			) : null}

			<div className="mt-5 min-w-0 space-y-5">
				{input.details.sections.map((section) => (
					<ProfileDetailsSectionView key={section.id} section={section} />
				))}
			</div>
		</div>
	);
}

function ProfileDetailsSectionView(input: { section: ProfileDetailsSection }) {
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
