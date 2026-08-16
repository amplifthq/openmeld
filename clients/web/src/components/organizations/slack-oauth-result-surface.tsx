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
import {
	resolveStatusToneProminentSurfaceClassName,
	resolveStatusToneSoftTextClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { useState } from "react";
import {
	resolveSlackOAuthResultMessage,
	type SlackOAuthResult,
} from "#/lib/organizations/slack-oauth-result";
import { buildSlackOAuthStartPath } from "#/lib/slack-oauth-start";

export function SlackOAuthResultSurface(input: {
	canManage: boolean;
	organizationName: string;
	organizationSlug: string;
	result?: SlackOAuthResult;
}) {
	if (!input.result) {
		return null;
	}
	if (input.result.status !== "move_required" || !input.canManage) {
		return <SlackOAuthResultBanner result={input.result} />;
	}
	return (
		<SlackWorkspaceMoveConfirmationDialog
			fromOrganizationId={input.result.fromOrganizationId}
			fromOrganizationName={input.result.fromOrganizationName}
			organizationName={input.organizationName}
			organizationSlug={input.organizationSlug}
		/>
	);
}

function SlackOAuthResultBanner(input: { result: SlackOAuthResult }) {
	const message = resolveSlackOAuthResultMessage(input.result);
	return (
		<div
			className={cn(
				"rounded-md border px-4 py-3",
				message.tone === "success"
					? resolveStatusToneProminentSurfaceClassName("ready")
					: "border-destructive bg-destructive/10"
			)}
			role={message.tone === "success" ? "status" : "alert"}
		>
			<p
				className={cn(
					"font-medium text-sm",
					message.tone === "success"
						? resolveStatusToneSoftTextClassName("ready")
						: "text-destructive"
				)}
			>
				{message.title}
			</p>
			<p className="mt-1 text-muted-foreground text-sm">
				{message.description}
			</p>
		</div>
	);
}

function SlackWorkspaceMoveConfirmationDialog(input: {
	fromOrganizationId: string;
	fromOrganizationName: string;
	organizationName: string;
	organizationSlug: string;
}) {
	const [open, setOpen] = useState(true);
	const moveUrl = buildSlackOAuthStartPath({
		moveFromOrganizationId: input.fromOrganizationId,
		organizationSlug: input.organizationSlug,
	});
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Move Slack workspace?</DialogTitle>
					<DialogDescription>
						This Slack workspace is currently connected to{" "}
						{input.fromOrganizationName}. Move it to {input.organizationName}?
						Slack messages will stop routing to {input.fromOrganizationName}.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						onClick={() => setOpen(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<a className={buttonVariants()} href={moveUrl}>
						Move workspace
					</a>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
