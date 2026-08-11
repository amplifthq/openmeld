"use client";

import type { SpaceAccessMode } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { CopyIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { copyTextToClipboard } from "#/lib/clipboard";
import {
	SpaceAccessEditor,
	type SpaceAccessUpdateInput,
} from "./space-access-editor";
import { buildPublicSpaceShareUrl } from "./space-share-url";

export function SpaceShareDialog(input: {
	accessMode: SpaceAccessMode;
	canManageAccess: boolean;
	errorMessage: string | null;
	isPending: boolean;
	onSetAccessMode: (input: SpaceAccessUpdateInput) => Promise<void>;
	spaceId: string;
	spaceName: string;
}) {
	const [origin] = useState<string | null>(() =>
		typeof window === "undefined" ? null : window.location.origin
	);
	const shareUrl = buildPublicSpaceShareUrl({
		origin,
		spaceId: input.spaceId,
	});

	return (
		<Dialog>
			<Tooltip>
				<TooltipTrigger
					render={
						<DialogTrigger
							render={
								<Button
									aria-label="Share space"
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									<ShareNetworkIcon />
								</Button>
							}
						/>
					}
				/>
				<TooltipContent side="bottom">Share space</TooltipContent>
			</Tooltip>
			<DialogContent className="flex max-h-[min(42rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden bg-surface-1 sm:max-w-xl">
				<DialogHeader className="shrink-0 pr-8">
					<DialogTitle>Share Space</DialogTitle>
					<DialogDescription>
						Share a read-only link to {input.spaceName}.
					</DialogDescription>
				</DialogHeader>

				<div
					className="min-h-0 min-w-0 flex-1 divide-y divide-border/60 overflow-y-auto pr-1"
					data-testid="space-share-dialog-scroll-area"
				>
					<section className="pb-4">
						<SpaceAccessEditor
							accessMode={input.accessMode}
							canManageAccess={input.canManageAccess}
							errorMessage={input.errorMessage}
							isPending={input.isPending}
							key={input.accessMode}
							onSetAccessMode={input.onSetAccessMode}
							readOnlyNote="Only the Space owner can change access."
						/>
					</section>

					<section className="min-w-0 space-y-1 pt-4">
						<p className="text-muted-foreground text-xs">Read-only link</p>
						<button
							aria-label="Copy share link"
							className="group grid w-full min-w-0 max-w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-3 overflow-hidden bg-surface-2 p-2 text-left text-xs transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
							onClick={async () => {
								await copyShareLink(shareUrl);
							}}
							type="button"
						>
							<span className="min-w-0 whitespace-pre-wrap break-all font-mono [overflow-wrap:anywhere]">
								{shareUrl}
							</span>
							<CopyIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
						</button>
					</section>
				</div>
			</DialogContent>
		</Dialog>
	);
}

async function copyShareLink(shareUrl: string) {
	if (await copyTextToClipboard(shareUrl)) {
		toast.success("Share link copied.");
		return;
	}

	toast.error(
		"OpenMeld could not copy this automatically. Select the text and copy it manually."
	);
}
