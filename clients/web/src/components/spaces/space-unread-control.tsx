import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ChatCircleIcon, XIcon } from "@phosphor-icons/react";
import { useMessageScrollerScrollable } from "@shadcn/react/message-scroller";
import {
	type ComponentProps,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { isInboxDocumentFocused } from "#/lib/inbox/desktop-notifications";

type Selection = { unreadCount: number; commit: () => Promise<void> };

function subscribeDocumentFocus(notify: () => void) {
	window.addEventListener("focus", notify);
	window.addEventListener("blur", notify);
	document.addEventListener("visibilitychange", notify);
	return () => {
		window.removeEventListener("focus", notify);
		window.removeEventListener("blur", notify);
		document.removeEventListener("visibilitychange", notify);
	};
}

export function SpaceConversationUnreadControl(
	input: ComponentProps<typeof SpaceUnreadControl> & {
		firstUnreadSignalId: string | null;
		threadRootSignalId?: string | null;
	}
) {
	const { end: canScrollToEnd } = useMessageScrollerScrollable();
	const focused = useSyncExternalStore(
		subscribeDocumentFocus,
		isInboxDocumentFocused,
		() => false
	);
	// The read observer still owns acknowledgements. Only suppress redundant
	// navigation while every outstanding update is arriving in this live view.
	const followingArrivals =
		focused &&
		!canScrollToEnd &&
		input.firstUnreadSignalId === null &&
		input.count === input.targets.length &&
		input.targets.every(
			(target) =>
				target.threadRootSignalId === (input.threadRootSignalId ?? null)
		);
	return <SpaceUnreadControl {...input} hideNavigation={followingArrivals} />;
}

export function SpaceUnreadControl(input: {
	count: number;
	scope?: "thread";
	hideNavigation?: boolean;
	targets: readonly SpaceInboxUnreadTarget[];
	onNavigate: (target: SpaceInboxUnreadTarget) => Promise<boolean>;
	onPrepareMarkAllRead?: () => Promise<Selection>;
}) {
	const [open, setOpen] = useState(false);
	const [selection, setSelection] = useState<Selection | null>(null);
	const [pending, setPending] = useState(false);
	const [navigating, setNavigating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const request = useRef(0);
	const readyLabel = selection ? "Mark all as read" : "Try again";
	const singular = input.scope === "thread" ? "reply" : "update";
	const plural = input.scope === "thread" ? "replies" : "updates";
	const noun = input.count === 1 ? singular : plural;
	const label = `${input.count} unread ${noun}`;
	const prepare = async () => {
		if (!input.onPrepareMarkAllRead) {
			return;
		}
		const sequence = ++request.current;
		setOpen(true);
		setError(null);
		setSelection(null);
		setPending(true);
		try {
			const next = await input.onPrepareMarkAllRead();
			if (sequence === request.current) {
				setSelection(next);
			}
		} catch (cause) {
			if (sequence === request.current) {
				setError(
					cause instanceof Error
						? cause.message
						: "Couldn’t load unread updates. Try again."
				);
			}
		} finally {
			if (sequence === request.current) {
				setPending(false);
			}
		}
	};
	const clear = async () => {
		if (!selection || pending) {
			return;
		}
		setPending(true);
		setError(null);
		try {
			await selection.commit();
			setOpen(false);
			setSelection(null);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Couldn’t mark updates as read. Try again."
			);
		} finally {
			setPending(false);
		}
	};
	if (input.count === 0 && !open) {
		return null;
	}
	return (
		<>
			{input.count > 0 && !input.hideNavigation && (
				<div
					className="pointer-events-auto inline-flex self-center overflow-hidden rounded-full border border-blue-200 bg-blue-50 text-blue-800 shadow-xs dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
					data-unread-navigation=""
				>
					<TooltipHint content="Jump to first unread">
						<Button
							aria-label={`${label}. Jump to first unread`}
							className="h-8 min-h-8 gap-1.5 rounded-none border-0 bg-transparent px-2.5 text-inherit text-xs hover:bg-blue-100 focus-visible:z-10 dark:hover:bg-blue-900 [@media(pointer:coarse)]:min-h-11"
							disabled={navigating || !input.targets[0]}
							onClick={async () => {
								const target = input.targets[0];
								if (!target || navigating) {
									return;
								}
								setNavigating(true);
								try {
									await input.onNavigate(target);
								} finally {
									setNavigating(false);
								}
							}}
							size="sm"
							variant="secondary"
						>
							<ChatCircleIcon aria-hidden="true" weight="bold" />
							<span>{label}</span>
						</Button>
					</TooltipHint>
					{input.onPrepareMarkAllRead && (
						<TooltipHint content="Mark all as read">
							<Button
								aria-label="Mark all as read"
								className="size-8 min-h-8 min-w-8 rounded-none border-0 border-blue-200 border-l bg-transparent px-0 text-inherit hover:bg-blue-100 focus-visible:z-10 dark:border-blue-800 dark:hover:bg-blue-900 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
								onClick={prepare}
								size="icon"
								variant="secondary"
							>
								<XIcon aria-hidden="true" />
							</Button>
						</TooltipHint>
					)}
				</div>
			)}
			<Dialog
				onOpenChange={(value) => {
					if (pending && selection) {
						return;
					}
					setOpen(value);
					if (!value) {
						request.current += 1;
						setPending(false);
					}
				}}
				open={open}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Mark all updates as read?</DialogTitle>
						<DialogDescription>
							This will mark all unread updates in this Space, including thread
							replies, as read for you.
						</DialogDescription>
					</DialogHeader>
					{error && (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button
							disabled={pending && !!selection}
							onClick={() => {
								request.current += 1;
								setOpen(false);
								setPending(false);
							}}
							variant="secondary"
						>
							Cancel
						</Button>
						<Button disabled={pending} onClick={selection ? clear : prepare}>
							{pending ? "Please wait…" : readyLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
