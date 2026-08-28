import {
	listAgentControllerPermissionModeOptions,
	parseAgentControllerRef,
} from "@openmeld/agent-runtime";
import type {
	AgentControllerPermissionMode,
	WakeProgressItem,
} from "@openmeld/schemas/types";
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

const LOW_INTERRUPTION_PERMISSION_MODE_BY_CONTROLLER_ID: Readonly<
	Record<string, AgentControllerPermissionMode>
> = {
	"claude-code": "claude-code:auto",
	codex: "codex:approveForMe",
	cursor: "cursor:autoReview",
	"grok-build": "grok-build:auto",
};

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
	const [selectedInteractionId, setSelectedInteractionId] = useState<
		string | null
	>(null);
	const [surfaceElement, setSurfaceElement] = useState<HTMLElement | null>(
		null
	);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const surfaceHadFocusRef = useRef(false);
	const panelId = useId();
	const selectedIndex = Math.max(
		0,
		actionableItems.findIndex(
			(item) => item.pendingInteraction?.interactionId === selectedInteractionId
		)
	);
	const selectedItem = actionableItems[selectedIndex] ?? null;
	const selectedItemId =
		selectedItem?.pendingInteraction?.interactionId ?? null;

	useEffect(() => {
		if (actionableItems.length > 0) {
			if (selectedInteractionId !== selectedItemId) {
				setSelectedInteractionId(selectedItemId);
			}
			return;
		}

		setIsOpen(false);
		setSelectedInteractionId(null);
		if (surfaceHadFocusRef.current) {
			input.returnFocusRef?.current?.focus();
		}
		surfaceHadFocusRef.current = false;
	}, [
		actionableItems.length,
		input.returnFocusRef,
		selectedInteractionId,
		selectedItemId,
	]);
	useEffect(() => {
		if (!surfaceElement) {
			return;
		}
		const markSurfaceFocused = () => {
			surfaceHadFocusRef.current = true;
		};
		surfaceElement.addEventListener("focusin", markSurfaceFocused);
		return () =>
			surfaceElement.removeEventListener("focusin", markSurfaceFocused);
	}, [surfaceElement]);
	useEffect(() => {
		if (!(surfaceElement && isOpen)) {
			return;
		}
		const closeOnEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			event.preventDefault();
			setIsOpen(false);
			triggerRef.current?.focus();
		};
		surfaceElement.addEventListener("keydown", closeOnEscape);
		return () => surfaceElement.removeEventListener("keydown", closeOnEscape);
	}, [isOpen, surfaceElement]);

	if (!selectedItem) {
		return null;
	}

	const count = actionableItems.length;
	const triggerLabel =
		count === 1 ? "1 action needs you" : `${count} actions need you`;
	const selectIndex = (nextIndex: number) => {
		const nextItem = actionableItems[nextIndex];
		if (nextItem?.pendingInteraction) {
			setSelectedInteractionId(nextItem.pendingInteraction.interactionId);
		}
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
						aria-expanded={isOpen}
						aria-label={triggerLabel}
						className="min-h-11 w-full justify-start gap-3 rounded-none px-3 py-2 text-left hover:bg-amber-500/8"
						onClick={() => setIsOpen((current) => !current)}
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
							className={cn("size-4 shrink-0", isOpen && "rotate-180")}
						/>
					</Button>
					{isOpen ? (
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

export function listActionablePendingAgentInteractions(
	items: readonly WakeProgressItem[]
): WakeProgressItem[] {
	const byInteractionId = new Map<string, WakeProgressItem>();
	for (const item of items) {
		const pendingInteraction = item.pendingInteraction;
		if (!(pendingInteraction?.canRespond && pendingInteraction.request)) {
			continue;
		}
		byInteractionId.set(pendingInteraction.interactionId, item);
	}
	return [...byInteractionId.values()].sort(
		(left, right) =>
			(left.pendingInteraction?.requestedAtMs ?? left.updatedAtMs) -
			(right.pendingInteraction?.requestedAtMs ?? right.updatedAtMs)
	);
}

export function resolveSpacePermissionModeShortcut(input: {
	agentControllerPermissionMode?: AgentControllerPermissionMode | null;
	agentControllerRef: string | null;
}): SpaceAgentPermissionModeShortcut | null {
	const controller = parseAgentControllerRef(input.agentControllerRef);
	if (controller?.kind !== "builtin") {
		return null;
	}
	const permissionMode =
		LOW_INTERRUPTION_PERMISSION_MODE_BY_CONTROLLER_ID[controller.id];
	if (
		!permissionMode ||
		input.agentControllerPermissionMode === permissionMode
	) {
		return null;
	}
	const option = listAgentControllerPermissionModeOptions({
		agentControllerRef: controller.ref,
	}).find((candidate) => candidate.value === permissionMode);
	if (!option || option.requiresExplicitConfirmation) {
		return null;
	}
	return {
		description: option.description,
		label: option.label,
		permissionMode,
	};
}
