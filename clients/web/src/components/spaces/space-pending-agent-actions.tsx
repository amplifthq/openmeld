import type {
	PluginActionRequestView,
	WakeProgressItem,
} from "@openmeld/schemas/types";
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
import { PluginActionRequest } from "#/components/inbox/plugin-action-request";
import {
	SpaceAgentInteractionCard,
	type SpaceAgentInteractionFailure,
	type SpaceAgentInteractionResponseHandler,
	type SpaceAgentPermissionModeOption,
	type SpaceAgentPermissionModeUpdateHandler,
} from "./space-agent-interaction-card";
import { SpaceAgentOrb } from "./space-agent-orb";
import { SpaceComposerTray } from "./space-composer-tray";
import {
	listActionablePendingAgentInteractions,
	resolveSpacePendingAgentActionIdentity,
} from "./space-pending-agent-action-model";

type PendingAgentActionsProps = {
	items: readonly WakeProgressItem[];
	pluginRequests?: readonly PluginActionRequestView[];
	onOpenPluginRequestThread?: (request: PluginActionRequestView) => void;
	onReloadRequests?: () => void;
	initialInteractionIdentity?: string;
	onOpenRequestThread?: (item: WakeProgressItem) => void;
	onPermissionModeUpdate?: SpaceAgentPermissionModeUpdateHandler;
	onRespond?: SpaceAgentInteractionResponseHandler;
	permissionModeOptionsByProfileId?: ReadonlyMap<
		string,
		readonly SpaceAgentPermissionModeOption[]
	>;
	returnFocusRef?: RefObject<{ focus: () => void } | null>;
};

type PendingAction = {
	identity: string;
	targetLabel: string;
	requestedAt: number;
} & (
	| { kind: "local"; item: WakeProgressItem }
	| { kind: "plugin"; request: PluginActionRequestView }
);

function listPendingActions(input: PendingAgentActionsProps): PendingAction[] {
	return [
		...listActionablePendingAgentInteractions(input.items).map(
			(item): PendingAction => ({
				identity: resolveSpacePendingAgentActionIdentity(item),
				targetLabel: item.targetLabel,
				requestedAt: item.pendingInteraction?.requestedAtMs ?? item.updatedAtMs,
				kind: "local",
				item,
			})
		),
		...(input.pluginRequests ?? [])
			.filter((request) => request.state === "pending")
			.map(
				(request): PendingAction => ({
					identity: `plugin:${request.requestId}`,
					targetLabel: `${request.service} · ${request.accountName}`,
					requestedAt: request.createdAtMs,
					kind: "plugin",
					request,
				})
			),
	].sort((left, right) => left.requestedAt - right.requestedAt);
}

// Agents keep a request pending until they actually resume. Treat the owner's
// answer as done the moment it is sent: skip to the next request that still
// needs the owner, and show nothing once none do.
function resolveDisplayedAction(
	actions: readonly PendingAction[],
	answeredIdentities: ReadonlySet<string>,
	selectedIdentity: string | null
): PendingAction | null {
	const selectedIndex = actions.findIndex(
		(action) => action.identity === selectedIdentity
	);
	const selected = actions[selectedIndex] ?? null;
	if (selected && !answeredIdentities.has(selected.identity)) {
		return selected;
	}
	const searchOrder =
		selectedIndex < 0
			? actions
			: [
					...actions.slice(selectedIndex + 1),
					...actions.slice(0, selectedIndex),
				];
	return (
		searchOrder.find((action) => !answeredIdentities.has(action.identity)) ??
		null
	);
}

export function SpacePendingAgentActions(input: PendingAgentActionsProps) {
	const actionableItems = useMemo(
		() =>
			listPendingActions({
				items: input.items,
				pluginRequests: input.pluginRequests,
			}),
		[input.items, input.pluginRequests]
	);
	const [isOpen, setIsOpen] = useState(
		Boolean(input.initialInteractionIdentity)
	);
	const [selectedInteractionIdentity, setSelectedInteractionIdentity] =
		useState<string | null>(input.initialInteractionIdentity ?? null);
	// Answers in flight or sent. An answer leaves the tray as soon as it is
	// submitted; a failed send puts the request back with its failure.
	const [answeredIdentities, setAnsweredIdentities] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const [failuresByIdentity, setFailuresByIdentity] = useState<
		ReadonlyMap<string, SpaceAgentInteractionFailure>
	>(() => new Map());
	const [surfaceElement, setSurfaceElement] = useState<HTMLElement | null>(
		null
	);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLFieldSetElement>(null);
	const focusPanelOnAdvanceRef = useRef(false);
	const surfaceHasFocusRef = useRef(false);
	const panelId = useId();
	const unansweredItems = useMemo(
		() =>
			actionableItems.filter((item) => !answeredIdentities.has(item.identity)),
		[actionableItems, answeredIdentities]
	);
	const selectedItem = resolveDisplayedAction(
		actionableItems,
		answeredIdentities,
		selectedInteractionIdentity
	);
	const selectedItemIdentity = selectedItem ? selectedItem.identity : null;
	const selectedIndex = Math.max(
		0,
		unansweredItems.findIndex((item) => item.identity === selectedItemIdentity)
	);
	const actionableInteractionIdentities = useMemo(
		() => new Set(actionableItems.map((item) => item.identity)),
		[actionableItems]
	);
	// A request the owner just answered may clear before the next one does;
	// keep the surface open on the next request instead of collapsing it.
	const selectedInteractionIsActionable =
		selectedItem !== null &&
		selectedInteractionIdentity !== null &&
		(actionableInteractionIdentities.has(selectedInteractionIdentity) ||
			answeredIdentities.has(selectedInteractionIdentity));
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
		if (!(focusPanelOnAdvanceRef.current && selectedItemIdentity)) {
			return;
		}
		focusPanelOnAdvanceRef.current = false;
		panelRef.current?.focus();
	}, [selectedItemIdentity]);
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
		return input.onReloadRequests ? (
			<SpaceComposerTray>
				<Button
					className="w-full"
					onClick={input.onReloadRequests}
					variant="ghost"
				>
					Reload pending actions
				</Button>
			</SpaceComposerTray>
		) : null;
	}

	const count = unansweredItems.length;
	const triggerLabel =
		count === 1 ? "1 action needs you" : `${count} actions need you`;
	const selectIndex = (nextIndex: number) => {
		const nextItem = unansweredItems[nextIndex];
		const nextIdentity = nextItem ? nextItem.identity : null;
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
	const markSubmitStarted = (identity: string) => {
		focusPanelOnAdvanceRef.current = surfaceHasFocusRef.current;
		setAnsweredIdentities((current) => new Set(current).add(identity));
		setFailuresByIdentity((current) => {
			const next = new Map(current);
			next.delete(identity);
			return next;
		});
		setSelectedInteractionIdentity(identity);
		// Answering the last request closes the tray, so a later request waits
		// for the owner to open it instead of popping open on its own.
		if (unansweredItems.every((item) => item.identity === identity)) {
			setIsOpen(false);
		}
	};
	const markSubmitFailed = (
		identity: string,
		failure: SpaceAgentInteractionFailure
	) => {
		setAnsweredIdentities((current) => {
			const next = new Set(current);
			next.delete(identity);
			return next;
		});
		setFailuresByIdentity((current) => new Map(current).set(identity, failure));
		setSelectedInteractionIdentity(identity);
		setIsOpen(true);
	};

	return (
		<SpaceComposerTray
			aria-label="Pending Agent actions"
			data-slot="space-pending-agent-actions"
			ref={setSurfaceElement}
		>
			{input.onReloadRequests ? (
				<Button
					className="w-full"
					onClick={input.onReloadRequests}
					variant="ghost"
				>
					Reload pending actions
				</Button>
			) : null}
			<Button
				aria-controls={panelId}
				aria-expanded={isSurfaceOpen}
				aria-label={triggerLabel}
				className="h-auto min-h-10 w-full justify-start gap-2 rounded-none rounded-t-[calc(1rem-1px)] border-0 px-3 py-2 text-left aria-expanded:bg-transparent aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/50"
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
					ref={panelRef}
					tabIndex={-1}
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
					<PendingActionContent
						action={selectedItem}
						input={input}
						key={selectedItemIdentity}
						onSubmitFailed={(failure) =>
							markSubmitFailed(selectedItem.identity, failure)
						}
						onSubmitStarted={() => markSubmitStarted(selectedItem.identity)}
						restoredFailure={failuresByIdentity.get(selectedItem.identity)}
					/>
				</fieldset>
			) : null}
		</SpaceComposerTray>
	);
}

function PendingActionContent({
	action,
	input,
	onSubmitFailed,
	onSubmitStarted,
	restoredFailure,
}: {
	action: PendingAction;
	input: PendingAgentActionsProps;
	onSubmitFailed: (failure: SpaceAgentInteractionFailure) => void;
	onSubmitStarted: () => void;
	restoredFailure?: SpaceAgentInteractionFailure;
}) {
	if (action.kind === "plugin") {
		if (action.request.sourceThreadId && input.onOpenPluginRequestThread) {
			return (
				<RequestThreadLink
					label="This Plugin action"
					onOpen={() => input.onOpenPluginRequestThread?.(action.request)}
				/>
			);
		}
		return (
			<PluginActionRequest
				presentation="surface"
				requestId={action.request.requestId}
			/>
		);
	}
	if (action.item.sourceContext?.threadId && input.onOpenRequestThread) {
		return (
			<RequestThreadLink
				label={action.targetLabel}
				onOpen={() => input.onOpenRequestThread?.(action.item)}
			/>
		);
	}
	return (
		<SpaceAgentInteractionCard
			item={action.item}
			onPermissionModeUpdate={input.onPermissionModeUpdate}
			onRespond={input.onRespond}
			onSubmitFailed={onSubmitFailed}
			onSubmitStarted={onSubmitStarted}
			permissionModeOptions={input.permissionModeOptionsByProfileId?.get(
				action.item.targetProfileId
			)}
			presentation="surface"
			restoredFailure={restoredFailure}
		/>
	);
}

function RequestThreadLink({
	label,
	onOpen,
}: {
	label: string;
	onOpen: () => void;
}) {
	return (
		<div className="grid gap-2">
			<p className="text-sm">{label} needs your response in a thread.</p>
			<Button onClick={onOpen} type="button" variant="outline">
				Open thread
			</Button>
		</div>
	);
}
