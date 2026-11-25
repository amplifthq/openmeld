import type {
	SpaceInboxUnreadTarget,
	SpaceInboxUnreadTargetsResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ChatCircleIcon } from "@phosphor-icons/react";
import { useMessageScrollerScrollable } from "@shadcn/react/message-scroller";
import { useState, useSyncExternalStore } from "react";
import { isInboxDocumentFocused } from "#/lib/inbox/desktop-notifications";

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

export function SpaceConversationUnreadControl(input: {
	count: number;
	firstUnreadSignalId: string | null;
	onNavigate: (target: SpaceInboxUnreadTarget) => Promise<boolean>;
	openThreadRootSignalId?: string;
	scopes?: SpaceInboxUnreadTargetsResponse["scopes"];
	targets: readonly SpaceInboxUnreadTarget[];
	threadRootSignalId?: string;
}) {
	const { end: canScrollToEnd } = useMessageScrollerScrollable();
	const focused = useSyncExternalStore(
		subscribeDocumentFocus,
		isInboxDocumentFocused,
		() => false
	);
	const [navigating, setNavigating] = useState(false);
	const { openThreadRootSignalId, targets } = input;
	// The open Thread has its own navigation and read observer.
	const eligible = openThreadRootSignalId
		? targets.filter(
				(target) => target.threadRootSignalId !== openThreadRootSignalId
			)
		: targets;
	const target = eligible[0];
	if (!target) {
		return null;
	}
	const complete = input.count === targets.length;
	let count: number | null = input.count;
	if (openThreadRootSignalId) {
		count = complete ? eligible.length : null;
		if (input.scopes) {
			count = input.scopes
				.filter((scope) => scope.threadRootSignalId !== openThreadRootSignalId)
				.reduce((total, scope) => total + scope.unreadCount, 0);
		}
	}
	if (count === 0) {
		return null;
	}
	const followingArrivals =
		focused &&
		!canScrollToEnd &&
		input.firstUnreadSignalId === null &&
		count === eligible.length &&
		eligible.every(
			(entry) => entry.threadRootSignalId === (input.threadRootSignalId ?? null)
		);
	if (followingArrivals) {
		return null;
	}
	const label = unreadNavigationLabel({
		count,
		inThread: !!input.threadRootSignalId,
		hasOpenThread: !!openThreadRootSignalId,
		targetInThread: target.threadRootSignalId !== null,
		oneScope: input.scopes
			? count ===
				input.scopes.find(
					(scope) => scope.threadRootSignalId === target.threadRootSignalId
				)?.unreadCount
			: complete &&
				eligible.every(
					(entry) => entry.threadRootSignalId === target.threadRootSignalId
				),
	});
	return (
		<TooltipHint content="Jump to first unread">
			<Button
				aria-label={`${label}. Jump to first unread`}
				className="pointer-events-auto h-8 min-h-8 gap-1.5 self-center rounded-full border border-blue-200 bg-blue-50 px-2.5 text-blue-800 text-xs shadow-xs hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900 [@media(pointer:coarse)]:min-h-11"
				data-unread-navigation=""
				disabled={navigating}
				onClick={async () => {
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
				{label}
			</Button>
		</TooltipHint>
	);
}

function unreadNavigationLabel(input: {
	count: number | null;
	hasOpenThread: boolean;
	inThread: boolean;
	oneScope: boolean;
	targetInThread: boolean;
}) {
	const { count } = input;
	const replies = count === 1 ? "reply" : "replies";
	if (input.inThread) {
		return `${count} unread ${replies}`;
	}
	const threadLocation = input.hasOpenThread ? "another thread" : "a thread";
	const location = input.targetInThread ? threadLocation : "main conversation";
	if (count === null) {
		return `Next unread in ${location}`;
	}
	if (!input.oneScope) {
		return `${count} unread · Next in ${location}`;
	}
	const noun = input.targetInThread ? ` ${replies}` : "";
	return `${count} unread${noun} in ${location}`;
}
