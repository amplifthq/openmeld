import { Input } from "@openmeld/ui/components/input";
import { cn } from "@openmeld/ui/lib/utils";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import {
	type MouseEvent,
	type RefObject,
	useCallback,
	useRef,
	useState,
} from "react";
import {
	SidebarDestinationAction,
	useSidebarDestinationActionSlot,
} from "./sidebar-destination-actions";
import { SidebarRowAction } from "./sidebar-row-action";

export function SidebarSearchInput(input: {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	label: string;
	inputClassName?: string;
	inputRef?: RefObject<HTMLInputElement | null>;
	placeholder?: string;
	destination?: "people" | "agents" | "spaces" | "home" | "directMessages";
	value: string;
	onValueChange: (value: string) => void;
}) {
	const [internalOpen, setInternalOpen] = useState(
		() => input.value.length > 0
	);
	const open = input.open ?? internalOpen;
	const setOpen = input.onOpenChange ?? setInternalOpen;
	const closable = Boolean(input.destination || input.onOpenChange);
	const slot = useSidebarDestinationActionSlot(input.destination);
	const trigger = useRef<HTMLSpanElement>(null);
	const searchInput = useRef<HTMLInputElement | null>(null);
	const focusInput = useCallback(
		(node: HTMLInputElement | null) => {
			searchInput.current = node;
			if (input.inputRef) {
				input.inputRef.current = node;
			}
			if (node && open) {
				node.focus({ preventScroll: true });
			}
		},
		[open, input.inputRef]
	);
	const close = () => {
		input.onValueChange("");
		setOpen(false);
		trigger.current?.querySelector("button")?.focus();
	};
	const revealed = !input.destination || slot === undefined || open;
	return (
		<>
			{input.destination && input.open === undefined && (
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
				<div className="relative min-w-0 flex-1">
					<MagnifyingGlassIcon
						aria-hidden="true"
						className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label={input.label}
						autoComplete="off"
						className={cn(
							"pr-8 pl-7 [&::-webkit-search-cancel-button]:appearance-none",
							input.inputClassName
						)}
						onChange={(event) => input.onValueChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape" && closable) {
								event.stopPropagation();
								close();
							}
						}}
						placeholder={input.placeholder ?? input.label}
						ref={focusInput}
						spellCheck={false}
						type="search"
						value={input.value}
					/>
					{closable && (
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

/** A menu can reveal search without restoring focus over the newly opened input. */
export function useSidebarSearchDisclosure() {
	const [open, setOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const requested = useRef(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	return {
		open,
		onOpenChange: (nextOpen: boolean) => {
			setOpen(nextOpen);
			if (!nextOpen) {
				triggerRef.current?.focus({ preventScroll: true });
			}
		},
		rememberTrigger: (event: MouseEvent<HTMLButtonElement>) => {
			triggerRef.current = event.currentTarget;
		},
		inputRef,
		reveal: () => {
			requested.current = true;
			setOpen(true);
		},
		finalFocus: () => {
			if (!requested.current) {
				return true;
			}
			requested.current = false;
			return inputRef.current ?? true;
		},
	};
}
