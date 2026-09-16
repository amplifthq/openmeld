import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useCallback } from "react";

export function DirectorySearch(input: {
	label: string;
	value: string;
	alwaysVisible?: boolean;
	open?: boolean;
	onChange: (value: string) => void;
	onOpenChange?: (open: boolean) => void;
}) {
	const focusSearch = useCallback(
		(node: HTMLInputElement | null) => node?.focus(),
		[]
	);
	return input.alwaysVisible || input.open || input.value ? (
		<div className="flex min-w-0 items-center gap-1">
			<Input
				aria-label={input.label}
				className="h-8 w-52 max-w-full"
				onChange={(event) => input.onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape" && !input.value && !input.alwaysVisible) {
						input.onOpenChange?.(false);
					}
				}}
				placeholder={`${input.label}…`}
				ref={focusSearch}
				type="search"
				value={input.value}
			/>
			{(!input.alwaysVisible || input.value) && (
				<Button
					aria-label={input.alwaysVisible ? "Clear search" : "Close search"}
					onClick={() => {
						input.onChange("");
						if (!input.alwaysVisible) {
							input.onOpenChange?.(false);
						}
					}}
					size="icon-sm"
					variant="ghost"
				>
					<XIcon />
				</Button>
			)}
		</div>
	) : (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label={input.label}
						onClick={() => input.onOpenChange?.(true)}
						size="icon-sm"
						variant="ghost"
					/>
				}
			>
				<MagnifyingGlassIcon />
			</TooltipTrigger>
			<TooltipContent side="top">{input.label}</TooltipContent>
		</Tooltip>
	);
}
