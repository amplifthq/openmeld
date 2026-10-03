import { cn } from "@openmeld/ui/lib/utils";
import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import type { DemoAgentName } from "../shared/demo-agent-icon";
import { DemoAgentIcon } from "../shared/demo-agent-icon";

type ProviderPanelShellProps = {
	agentName: DemoAgentName;
	children: ReactNode;
	className?: string;
	isVisible: boolean;
	onClose?: () => void;
	shouldScrollToBottom?: boolean;
	tabLabel: string;
	testId: string;
};

export function ProviderPanelShell({
	agentName,
	children,
	className,
	isVisible,
	onClose,
	shouldScrollToBottom = false,
	tabLabel,
	testId,
}: ProviderPanelShellProps) {
	const bodyRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!(isVisible && shouldScrollToBottom)) {
			return;
		}

		const bodyElement = bodyRef.current;

		if (!bodyElement) {
			return;
		}

		const prefersReducedMotion =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		const scrollToBottom = (behavior: ScrollBehavior) => {
			if (typeof bodyElement.scrollTo === "function") {
				bodyElement.scrollTo({
					behavior,
					top: bodyElement.scrollHeight,
				});
				return;
			}

			bodyElement.scrollTop = bodyElement.scrollHeight;
		};

		scrollToBottom(prefersReducedMotion ? "auto" : "smooth");

		const settleToBottom = () => {
			scrollToBottom("auto");
		};
		const animationFrameId = window.requestAnimationFrame(settleToBottom);
		const timeoutId = window.setTimeout(settleToBottom, 220);
		const mutationObserver =
			typeof MutationObserver === "function"
				? new MutationObserver(settleToBottom)
				: null;
		const resizeObserver =
			typeof ResizeObserver === "function"
				? new ResizeObserver(settleToBottom)
				: null;

		mutationObserver?.observe(bodyElement, {
			characterData: true,
			childList: true,
			subtree: true,
		});
		resizeObserver?.observe(bodyElement);

		return () => {
			window.cancelAnimationFrame(animationFrameId);
			window.clearTimeout(timeoutId);
			mutationObserver?.disconnect();
			resizeObserver?.disconnect();
		};
	}, [isVisible, shouldScrollToBottom]);

	return (
		<section
			aria-hidden={!isVisible}
			className={cn(
				"flex h-full min-h-0 flex-col bg-background font-mono text-[0.82rem] text-foreground/84 leading-[1.55] transition-all duration-500 ease-out motion-reduce:transition-none",
				isVisible
					? "translate-y-0 opacity-100"
					: "translate-y-3 opacity-0 lg:pointer-events-none",
				className
			)}
			data-testid={testId}
			data-visible={isVisible ? "true" : "false"}
		>
			<div className="flex h-9 shrink-0 items-center border-border/70 border-b bg-card/35 px-3">
				<div className="inline-flex min-w-0 items-center gap-2 text-[0.78rem] text-foreground/92">
					<DemoAgentIcon name={agentName} size="sm" />
					<span className="truncate">{tabLabel}</span>
				</div>
				<button
					aria-label={`Close ${tabLabel}`}
					className="ml-auto inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
					data-testid={`provider-close-${agentName}`}
					onClick={onClose}
					type="button"
				>
					<X className="size-3.5" weight="bold" />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-4" ref={bodyRef}>
				{children}
			</div>
		</section>
	);
}
