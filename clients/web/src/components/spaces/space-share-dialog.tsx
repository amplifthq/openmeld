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
import { ShareNetworkIcon } from "@phosphor-icons/react";
import {
	SpaceAccessSettings,
	type SpaceAccessSettingsProps,
} from "./space-access-settings";

export function SpaceShareDialog(
	input: SpaceAccessSettingsProps & {
		onOpenChange?: (open: boolean) => void;
		open?: boolean;
		spaceName: string;
	}
) {
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
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
				className="flex max-h-[min(48rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-[680px]"
				size="lg"
			>
				<DialogHeader className="shrink-0 pr-8">
					<DialogTitle>Share</DialogTitle>
					<p className="line-clamp-2 pr-2 text-muted-foreground text-sm">
						{input.spaceName}
					</p>
					<DialogDescription className="sr-only">
						Invite people or share a link to this Space.
					</DialogDescription>
				</DialogHeader>
				<SpaceAccessSettings {...input} surface="share" />
			</DialogContent>
		</Dialog>
	);
}
