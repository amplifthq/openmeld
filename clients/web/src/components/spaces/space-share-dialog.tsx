"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
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
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { ShareNetworkIcon } from "@phosphor-icons/react";
import {
	SpaceAccessSettings,
	type SpaceAccessSettingsProps,
} from "./space-access-settings";

export function SpaceShareDialog(
	input: SpaceAccessSettingsProps & { spaceName: string }
) {
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
			<DialogContent
				className="flex max-h-[min(42rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden"
				size="lg"
			>
				<DialogHeader className="shrink-0 pr-8">
					<DialogTitle>Share {input.spaceName}</DialogTitle>
					<DialogDescription className="sr-only">
						Invite people or share a link to this Space.
					</DialogDescription>
				</DialogHeader>
				<ScrollArea
					className="min-h-0 min-w-0 flex-1"
					contentClassName="pr-1"
					data-testid="space-share-dialog-scroll-area"
					orientation="vertical"
				>
					<SpaceAccessSettings {...input} surface="share" />
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}
