import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidContextMenuContent } from "@openmeld/ui/fluid/context-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { DotsThreeIcon } from "@phosphor-icons/react";
import type { RefObject } from "react";
import { useAppLinkCapability } from "../app/app-link-capability";

export type SkillAction =
	| "copy"
	| "usage"
	| "properties"
	| "history"
	| "maintainers"
	| "toggle"
	| "remove";

export function OrganizationSkillActions(input: {
	canManage: boolean;
	enabled: boolean;
	managementBlocked: boolean;
	onAction: (action: SkillAction) => void;
	triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const canCopyLink = useAppLinkCapability();
	const items = (
		<>
			<FluidDropdownMenuGroup>
				{canCopyLink && (
					<FluidDropdownMenuItem
						index={0}
						onClick={() => input.onAction("copy")}
					>
						Copy link
					</FluidDropdownMenuItem>
				)}
				<FluidDropdownMenuItem
					index={1}
					onClick={() => input.onAction("usage")}
				>
					How agents use this skill
				</FluidDropdownMenuItem>
			</FluidDropdownMenuGroup>
			<DropdownMenuSeparator />
			<FluidDropdownMenuGroup>
				<FluidDropdownMenuItem
					index={2}
					onClick={() => input.onAction("properties")}
				>
					Properties
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem
					index={3}
					onClick={() => input.onAction("history")}
				>
					Version history
				</FluidDropdownMenuItem>
			</FluidDropdownMenuGroup>
			{input.canManage && (
				<>
					<DropdownMenuSeparator />
					<FluidDropdownMenuGroup>
						{input.managementBlocked && (
							<p className="px-2 py-1 text-muted-foreground text-xs">
								Finish saving your changes first.
							</p>
						)}
						<FluidDropdownMenuItem
							disabled={input.managementBlocked}
							index={4}
							onClick={() => input.onAction("maintainers")}
						>
							Manage maintainers
						</FluidDropdownMenuItem>
						<FluidDropdownMenuItem
							disabled={input.managementBlocked}
							index={5}
							onClick={() => input.onAction("toggle")}
						>
							{input.enabled ? "Disable skill" : "Enable skill"}
						</FluidDropdownMenuItem>
					</FluidDropdownMenuGroup>
					<DropdownMenuSeparator />
					<FluidDropdownMenuGroup>
						<FluidDropdownMenuItem
							disabled={input.managementBlocked}
							index={6}
							onClick={() => input.onAction("remove")}
							variant="destructive"
						>
							Remove skill
						</FluidDropdownMenuItem>
					</FluidDropdownMenuGroup>
				</>
			)}
		</>
	);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					aria-label="More actions"
					ref={input.triggerRef}
					render={
						<Button
							className="relative max-lg:min-h-8 max-lg:min-w-8 max-lg:after:absolute max-lg:after:-inset-1.5 max-lg:after:content-['']"
							size="icon"
							variant="ghost"
						/>
					}
				>
					<DotsThreeIcon aria-hidden="true" className="size-5" />
				</DropdownMenuTrigger>
				<FluidDropdownMenuContent align="end" className="w-64">
					{items}
				</FluidDropdownMenuContent>
			</DropdownMenu>
			<FluidContextMenuContent className="w-64">
				{items}
			</FluidContextMenuContent>
		</>
	);
}
