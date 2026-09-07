import { Input } from "@openmeld/ui/components/input";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";
import {
	SidebarDestinationAction,
	useSidebarDestinationActionSlot,
} from "./sidebar-destination-actions";
import { SidebarRowAction } from "./sidebar-row-action";

export function SidebarSearchInput(input: {
	label: string;
	destination?: "people" | "agents" | "spaces" | "home";
	value: string;
	onValueChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(() => input.value.length > 0);
	const slot = useSidebarDestinationActionSlot(input.destination);
	const trigger = useRef<HTMLSpanElement>(null);
	const searchInput = useRef<HTMLInputElement | null>(null);
	const focusInput = useCallback(
		(node: HTMLInputElement | null) => {
			searchInput.current = node;
			if (node && open) {
				node.focus({ preventScroll: true });
			}
		},
		[open]
	);
	const close = () => {
		input.onValueChange("");
		setOpen(false);
		trigger.current?.querySelector("button")?.focus();
	};
	const revealed = !input.destination || slot === undefined || open;
	return (
		<>
			{input.destination && (
				<SidebarDestinationAction destination={input.destination}>
					<span ref={trigger}>
						<SidebarRowAction
							label={input.label}
							onClick={() => {
								setOpen(true);
								searchInput.current?.focus({ preventScroll: true });
							}}
						>
							<MagnifyingGlassIcon />
						</SidebarRowAction>
					</span>
				</SidebarDestinationAction>
			)}
			{revealed && (
				<div className="fade-in slide-in-from-top-1 relative min-w-0 flex-1 animate-in duration-150 motion-reduce:animate-none">
					<MagnifyingGlassIcon
						aria-hidden="true"
						className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label={input.label}
						autoComplete="off"
						className="pr-8 pl-7 [&::-webkit-search-cancel-button]:appearance-none"
						onChange={(event) => input.onValueChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape" && input.destination) {
								event.stopPropagation();
								close();
							}
						}}
						placeholder={input.label}
						ref={focusInput}
						spellCheck={false}
						type="search"
						value={input.value}
					/>
					{input.destination && (
						<span className="absolute top-1/2 right-1 -translate-y-1/2">
							<SidebarRowAction label="Close search" onClick={close}>
								<XIcon />
							</SidebarRowAction>
						</span>
					)}
				</div>
			)}
		</>
	);
}
