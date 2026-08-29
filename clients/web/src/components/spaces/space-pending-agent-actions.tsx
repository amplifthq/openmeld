import type { WakeProgressItem } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CaretDownIcon,
	CaretLeftIcon,
	CaretRightIcon,
	WarningCircleIcon,
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
	type SpaceAgentProfileEditHandler,
} from "./space-agent-interaction-card";
import {
	listActionablePendingAgentInteractions,
	resolveSpacePendingAgentActionIdentity,
} from "./space-pending-agent-action-model";

export function SpacePendingAgentActions(input: {
	items: readonly WakeProgressItem[];
	onEditAgentProfile?: SpaceAgentProfileEditHandler;
	onPermissionModeUpdate?: SpaceAgentPermissionModeUpdateHandler;
	onRespond?: SpaceAgentInteractionResponseHandler;
	permissionModeShortcutsByProfileId?: ReadonlyMap<
		string,
		SpaceAgentPermissionModeShortcut
	>;
	returnFocusRef?: RefObject<HTMLElement | null>;
}) {
	const actionableItems = useMemo(
		() => listActionablePendingAgentInteractions(input.items),
		[input.items]
	);
	const [isOpen, setIsOpen] = useState(false);
	const [selectedInteractionIdentity, setSelectedInteractionIdentity] =
		useState<string | null>(null);
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
			className="shrink-0 bg-background"
			data-slot="space-pending-agent-actions"
			ref={setSurfaceElement}
		>
			<div className="w-full pb-2" data-space-conversation-content-width="">
				<div className="overflow-hidden rounded-md border border-amber-500/35 bg-amber-500/6 shadow-sm">
					<Button
						aria-controls={panelId}
						aria-expanded={isSurfaceOpen}
						aria-label={triggerLabel}
						className="min-h-11 w-full justify-start gap-3 rounded-none px-3 py-2 text-left hover:bg-amber-500/8"
						onClick={toggleSurface}
						ref={triggerRef}
						type="button"
						variant="ghost"
					>
						<WarningCircleIcon
							aria-hidden="true"
							className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
							weight="fill"
						/>
						<span className="min-w-0 flex-1">
							<span aria-live="polite" className="block font-medium text-sm">
								{triggerLabel}
							</span>
							<span className="block truncate text-muted-foreground text-xs">
								{selectedItem.targetLabel} is waiting for your response
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
							className="max-h-[min(60dvh,34rem)] min-w-0 overflow-y-auto border-0 border-amber-500/25 border-t p-3 sm:p-4"
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
							<SpaceAgentInteractionCard
								item={selectedItem}
								key={selectedItemIdentity}
								onEditAgentProfile={input.onEditAgentProfile}
								onPermissionModeUpdate={input.onPermissionModeUpdate}
								onRespond={input.onRespond}
								permissionModeShortcut={input.permissionModeShortcutsByProfileId?.get(
									selectedItem.targetProfileId
								)}
								presentation="surface"
							/>
						</fieldset>
					) : null}
				</div>
			</div>
		</section>
	);
}
