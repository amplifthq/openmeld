import type { WakeProgressItem } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CaretDownIcon,
	CaretLeftIcon,
	CaretRightIcon,
} from "@phosphor-icons/react";
import {
	type RefObject,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	SpaceAgentInteractionCard,
	type SpaceAgentInteractionResponseHandler,
	type SpaceAgentPermissionModeShortcut,
	type SpaceAgentPermissionModeUpdateHandler,
} from "./space-agent-interaction-card";
import { SpaceAgentOrb } from "./space-agent-orb";
import {
	listActionablePendingAgentInteractions,
	resolveSpacePendingAgentActionIdentity,
} from "./space-pending-agent-action-model";

export function SpacePendingAgentActions(input: {
	items: readonly WakeProgressItem[];
	initialInteractionIdentity?: string;
	onOpenRequestThread?: (item: WakeProgressItem) => void;
	onPermissionModeUpdate?: SpaceAgentPermissionModeUpdateHandler;
	onRespond?: SpaceAgentInteractionResponseHandler;
	permissionModeShortcutsByProfileId?: ReadonlyMap<
		string,
		SpaceAgentPermissionModeShortcut
	>;
	returnFocusRef?: RefObject<{ focus: () => void } | null>;
}) {
	const actionableItems = useMemo(
		() => listActionablePendingAgentInteractions(input.items),
		[input.items]
	);
	const [isOpen, setIsOpen] = useState(
		Boolean(input.initialInteractionIdentity)
	);
	const [selectedInteractionIdentity, setSelectedInteractionIdentity] =
		useState<string | null>(input.initialInteractionIdentity ?? null);
	const [surfaceElement, setSurfaceElement] = useState<HTMLElement | null>(
		null
	);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const surfaceHasFocusRef = useRef(false);
	const panelId = useId();
	const selectedIndex = Math.max(
		0,
		actionableItems.findIndex(
			(item) =>
				resolveSpacePendingAgentActionIdentity(item) ===
				selectedInteractionIdentity
		)
	);
	const selectedItem = actionableItems[selectedIndex] ?? null;
	const selectedItemIdentity = selectedItem
		? resolveSpacePendingAgentActionIdentity(selectedItem)
		: null;
	const actionableInteractionIdentities = useMemo(
		() =>
			new Set(
				actionableItems.map((item) =>
					resolveSpacePendingAgentActionIdentity(item)
				)
			),
		[actionableItems]
	);
	const selectedInteractionIsActionable =
		selectedInteractionIdentity !== null &&
		actionableInteractionIdentities.has(selectedInteractionIdentity);
	const isSurfaceOpen = isOpen && selectedInteractionIsActionable;

	useEffect(() => {
		if (!selectedInteractionIsActionable && surfaceHasFocusRef.current) {
			input.returnFocusRef?.current?.focus();
			surfaceHasFocusRef.current = false;
		}
	}, [input.returnFocusRef, selectedInteractionIsActionable]);
	useEffect(() => {
		if (!surfaceElement) {
			return;
		}
		const markSurfaceFocused = () => {
			surfaceHasFocusRef.current = true;
		};
		const clearSurfaceFocus = (event: FocusEvent) => {
			const nextTarget = event.relatedTarget;
			if (
				!(nextTarget instanceof Node && surfaceElement.contains(nextTarget))
			) {
				surfaceHasFocusRef.current = false;
			}
		};
		surfaceElement.addEventListener("focusin", markSurfaceFocused);
		surfaceElement.addEventListener("focusout", clearSurfaceFocus);
		return () => {
			surfaceElement.removeEventListener("focusin", markSurfaceFocused);
			surfaceElement.removeEventListener("focusout", clearSurfaceFocus);
		};
	}, [surfaceElement]);
	useEffect(() => {
		if (!(surfaceElement && isSurfaceOpen)) {
			return;
		}
		const closeOnEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			event.preventDefault();
			surfaceHasFocusRef.current = false;
			setIsOpen(false);
			triggerRef.current?.focus();
		};
		surfaceElement.addEventListener("keydown", closeOnEscape);
		return () => surfaceElement.removeEventListener("keydown", closeOnEscape);
	}, [isSurfaceOpen, surfaceElement]);

	if (!selectedItem) {
		return null;
	}

	const count = actionableItems.length;
	const triggerLabel =
		count === 1 ? "1 action needs you" : `${count} actions need you`;
	const selectIndex = (nextIndex: number) => {
		const nextItem = actionableItems[nextIndex];
		const nextIdentity = nextItem
			? resolveSpacePendingAgentActionIdentity(nextItem)
			: null;
		if (nextIdentity) {
			setSelectedInteractionIdentity(nextIdentity);
		}
	};
	const toggleSurface = () => {
		if (isSurfaceOpen) {
			surfaceHasFocusRef.current = false;
			setIsOpen(false);
			return;
		}
		setSelectedInteractionIdentity(selectedItemIdentity);
		setIsOpen(true);
	};

	return (
		<section
			aria-label="Pending Agent actions"
			className="relative mx-3 -mb-4 shrink-0 rounded-2xl border border-border bg-card pb-4 sm:mx-4"
			data-slot="space-pending-agent-actions"
			ref={setSurfaceElement}
		>
			<div className="min-w-0">
				<Button
					aria-controls={panelId}
					aria-expanded={isSurfaceOpen}
					aria-label={triggerLabel}
					className="h-auto min-h-10 w-full justify-start gap-2 rounded-2xl px-3 py-2 text-left"
					onClick={toggleSurface}
					ref={triggerRef}
					type="button"
					variant="ghost"
				>
					<SpaceAgentOrb state="listening" />
					<span className="min-w-0 flex-1">
						<span aria-live="polite" className="block font-medium text-sm">
							{triggerLabel}
						</span>
						<span className="block truncate text-muted-foreground text-xs">
							{selectedItem.targetLabel}
						</span>
					</span>
					<CaretDownIcon
						aria-hidden="true"
						className={cn("size-4 shrink-0", isSurfaceOpen && "rotate-180")}
					/>
				</Button>
				{isSurfaceOpen ? (
					<fieldset
						aria-label="Current pending action"
						className="min-w-0 border-0 border-border border-t p-3"
						id={panelId}
					>
						{count > 1 ? (
							<div className="mb-2 flex items-center justify-between gap-3">
								<p className="text-muted-foreground text-xs">
									Action {selectedIndex + 1} of {count}
								</p>
								<div className="flex items-center gap-1">
									<Button
										aria-label="Previous action"
										disabled={selectedIndex === 0}
										onClick={() => selectIndex(selectedIndex - 1)}
										size="icon-sm"
										type="button"
										variant="ghost"
									>
										<CaretLeftIcon aria-hidden="true" />
									</Button>
									<Button
										aria-label="Next action"
										disabled={selectedIndex === count - 1}
										onClick={() => selectIndex(selectedIndex + 1)}
										size="icon-sm"
										type="button"
										variant="ghost"
									>
										<CaretRightIcon aria-hidden="true" />
									</Button>
								</div>
							</div>
						) : null}
						{selectedItem.sourceContext?.threadId &&
						input.onOpenRequestThread ? (
							<div className="grid gap-2">
								<p className="text-sm">
									{selectedItem.targetLabel} needs your response in a thread.
								</p>
								<Button
									onClick={() => input.onOpenRequestThread?.(selectedItem)}
									type="button"
									variant="outline"
								>
									Open thread
								</Button>
							</div>
						) : (
							<SpaceAgentInteractionCard
								item={selectedItem}
								key={selectedItemIdentity}
								onPermissionModeUpdate={input.onPermissionModeUpdate}
								onRespond={input.onRespond}
								permissionModeShortcut={input.permissionModeShortcutsByProfileId?.get(
									selectedItem.targetProfileId
								)}
								presentation="surface"
							/>
						)}
					</fieldset>
				) : null}
			</div>
		</section>
	);
}
