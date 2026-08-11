import { useReducedMotion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { firstSectionDemoScript } from "./demo-script";
import type { DemoPlayerStatus, DemoScript } from "./demo-types";
import { ProviderPanelStack } from "./providers/provider-panel-stack";
import type { DemoAgentName } from "./shared/demo-agent-icon";
import { isDemoAgentName } from "./shared/demo-agent-icon";
import { DemoWorkspaceLayout } from "./shared/demo-workspace-layout";
import { TerminalCommandDockOverlay } from "./shared/terminal-command-dock-overlay";
import { TerminalCommandText } from "./shared/terminal-command-text";
import { TerminalWindow } from "./shared/terminal-window";
import { BringAgentsStage } from "./stages/bring-agents-stage";
import { CliIntroStage } from "./stages/cli-intro-stage";
import { CreateSpaceStage } from "./stages/create-space-stage";
import { SetupChecksStage } from "./stages/setup-checks-stage";
import { SpaceConversationStage } from "./stages/space-conversation-stage";
import { StartCommandStage } from "./stages/start-command-stage";
import { useDemoPlayer } from "./use-demo-player";

const ACTIVE_CONTENT_VIEWPORT_ANCHOR_RATIO = 0.62;
const COMPLETED_CONTENT_VIEWPORT_ANCHOR_RATIO = 0.94;
type CommandDockAnimation = {
	sourceHeight: number;
	sourceLeft: number;
	sourceTop: number;
	sourceWidth: number;
	targetLeft: number;
	targetTop: number;
};

function alignScrollElementToAnchor(
	scrollElement: HTMLDivElement,
	anchorElement: HTMLDivElement,
	anchorRatio: number,
	shouldAnimate: boolean
) {
	const scrollContainerRect = scrollElement.getBoundingClientRect();
	const anchorRect = anchorElement.getBoundingClientRect();
	const anchorOffsetTop =
		scrollElement.scrollTop + (anchorRect.top - scrollContainerRect.top);
	const targetScrollTop = Math.max(
		0,
		anchorOffsetTop - scrollElement.clientHeight * anchorRatio
	);

	if (Math.abs(scrollElement.scrollTop - targetScrollTop) < 4) {
		return;
	}

	if (typeof scrollElement.scrollTo === "function") {
		try {
			scrollElement.scrollTo({
				behavior: shouldAnimate ? "smooth" : "auto",
				top: targetScrollTop,
			});
			return;
		} catch {
			// Fall back to direct assignment in environments without scroll options support.
		}
	}

	scrollElement.scrollTop = targetScrollTop;
}

function getStatusLabel(status: DemoPlayerStatus): string {
	switch (status) {
		case "idle":
			return "Standby";
		case "playing":
			return "Running";
		case "completed":
			return "Complete";
		default:
			return "Standby";
	}
}

export function DemoPlayer({
	script = firstSectionDemoScript,
}: {
	script?: DemoScript;
}) {
	const openMeldContentEndRef = useRef<HTMLDivElement | null>(null);
	const commandSourceRef = useRef<HTMLSpanElement | null>(null);
	const headerCommandTargetRef = useRef<HTMLDivElement | null>(null);
	const terminalWindowRef = useRef<HTMLElement | null>(null);
	const workspaceScrollRef = useRef<HTMLDivElement | null>(null);
	const openMeldPaneScrollRef = useRef<HTMLDivElement | null>(null);
	const [closedProviderNames, setClosedProviderNames] = useState<
		Set<DemoAgentName>
	>(() => new Set());
	const [commandDockAnimation, setCommandDockAnimation] =
		useState<CommandDockAnimation | null>(null);
	const [hasCommandDockedToHeader, setHasCommandDockedToHeader] =
		useState(false);
	const shouldReduceMotion = useReducedMotion();
	const setupReadyAgentNames = script.agentSessions.flatMap((session) =>
		isDemoAgentName(session.profileName) ? [session.profileName] : []
	);
	const {
		isStarted,
		start,
		startTriggerRef,
		status,
		visibleBeatCount,
		visibleBeatMap,
	} = useDemoPlayer(script);

	useEffect(() => {
		if (!isStarted) {
			setCommandDockAnimation(null);
			setHasCommandDockedToHeader(false);
			return;
		}
	}, [isStarted]);

	useLayoutEffect(() => {
		if (!isStarted) {
			return;
		}

		if (shouldReduceMotion) {
			setHasCommandDockedToHeader(true);
			setCommandDockAnimation(null);
			return;
		}

		if (hasCommandDockedToHeader || commandDockAnimation) {
			return;
		}

		const terminalWindow = terminalWindowRef.current;
		const sourceElement = commandSourceRef.current;
		const targetElement = headerCommandTargetRef.current;
		if (!(terminalWindow && sourceElement)) {
			return;
		}

		if (!targetElement) {
			return;
		}

		const terminalRect = terminalWindow.getBoundingClientRect();
		const sourceRect = sourceElement.getBoundingClientRect();
		const targetRect = targetElement.getBoundingClientRect();
		if (
			sourceRect.width === 0 ||
			sourceRect.height === 0 ||
			targetRect.width === 0 ||
			targetRect.height === 0
		) {
			return;
		}

		setCommandDockAnimation({
			sourceHeight: sourceRect.height,
			sourceLeft: sourceRect.left - terminalRect.left,
			sourceTop: sourceRect.top - terminalRect.top,
			sourceWidth: sourceRect.width,
			targetLeft: targetRect.left - terminalRect.left,
			targetTop: targetRect.top - terminalRect.top,
		});
	}, [
		commandDockAnimation,
		hasCommandDockedToHeader,
		isStarted,
		shouldReduceMotion,
	]);

	useEffect(() => {
		if (isStarted) {
			return;
		}

		const handleWindowKeyDown = (event: KeyboardEvent) => {
			if (
				event.key !== "Enter" ||
				event.defaultPrevented ||
				event.isComposing ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			) {
				return;
			}

			const eventTarget = event.target;
			if (
				eventTarget instanceof HTMLElement &&
				(eventTarget.isContentEditable ||
					eventTarget.closest(
						'input, textarea, select, [role="textbox"], [contenteditable="true"]'
					))
			) {
				return;
			}

			event.preventDefault();
			start();
		};

		window.addEventListener("keydown", handleWindowKeyDown);

		return () => {
			window.removeEventListener("keydown", handleWindowKeyDown);
		};
	}, [isStarted, start]);

	useEffect(() => {
		if (!isStarted) {
			return;
		}

		if (visibleBeatCount === 0) {
			if (workspaceScrollRef.current) {
				workspaceScrollRef.current.scrollTop = 0;
			}
			if (openMeldPaneScrollRef.current) {
				openMeldPaneScrollRef.current.scrollTop = 0;
			}
			return;
		}

		const anchorElement = openMeldContentEndRef.current;
		if (!anchorElement) {
			return;
		}

		const anchorRatio =
			status === "completed"
				? COMPLETED_CONTENT_VIEWPORT_ANCHOR_RATIO
				: ACTIVE_CONTENT_VIEWPORT_ANCHOR_RATIO;

		for (const scrollElement of [
			workspaceScrollRef.current,
			openMeldPaneScrollRef.current,
		]) {
			if (!scrollElement) {
				continue;
			}

			alignScrollElementToAnchor(
				scrollElement,
				anchorElement,
				anchorRatio,
				visibleBeatCount > 1
			);
		}
	}, [isStarted, status, visibleBeatCount]);

	const isProviderLayoutVisible =
		visibleBeatMap[script.providerLayoutBeat.id] === true &&
		script.agentSessions.some(
			(session) =>
				visibleBeatMap[session.beats.panelVisible.id] === true &&
				!closedProviderNames.has(session.profileName)
		);
	const isCommandDockingToHeader = commandDockAnimation !== null;

	return (
		<div className="mx-auto w-full">
			<TerminalWindow
				ariaLabel="OpenMeld landing demo terminal"
				className="h-136 max-h-[calc(100vh-4rem)] sm:h-152 sm:max-h-[calc(100vh-6rem)] lg:h-160"
				contentClassName="h-full overflow-hidden px-0 py-0"
				overlay={
					commandDockAnimation ? (
						<TerminalCommandDockOverlay
							command={script.prefilledCommand}
							onComplete={() => {
								setCommandDockAnimation(null);
								setHasCommandDockedToHeader(true);
							}}
							sourceHeight={commandDockAnimation.sourceHeight}
							sourceLeft={commandDockAnimation.sourceLeft}
							sourceTop={commandDockAnimation.sourceTop}
							sourceWidth={commandDockAnimation.sourceWidth}
							targetLeft={commandDockAnimation.targetLeft}
							targetTop={commandDockAnimation.targetTop}
						/>
					) : null
				}
				rootRef={terminalWindowRef}
				statusLabel={getStatusLabel(status)}
				title="openmeld.ai — zsh"
				titleAfter={
					isStarted ? (
						<div
							className={hasCommandDockedToHeader ? "opacity-100" : "opacity-0"}
						>
							<TerminalCommandText
								className="truncate text-[0.95rem] sm:text-[1rem]"
								command={script.prefilledCommand}
							/>
						</div>
					) : null
				}
				titleAfterRef={headerCommandTargetRef}
			>
				<DemoWorkspaceLayout
					isProviderLayoutVisible={isProviderLayoutVisible}
					openMeldPane={
						<div
							className={
								status === "completed"
									? "flex min-h-full flex-col px-4 py-4 pb-4 transition-[padding] duration-500 ease-out sm:px-5 sm:pb-5 lg:pb-6"
									: "flex min-h-full flex-col px-4 py-4 pb-28 transition-[padding] duration-500 ease-out sm:px-5 sm:pb-32 lg:pb-36"
							}
						>
							<StartCommandStage
								command={script.prefilledCommand}
								commandSourceRef={commandSourceRef}
								hasCommandDockedToHeader={hasCommandDockedToHeader}
								isDockingToHeader={isCommandDockingToHeader}
								isStarted={isStarted}
								onStart={start}
								startPrompt={script.startPrompt}
								startTriggerRef={startTriggerRef}
							/>
							<div className="mt-0 space-y-4 sm:space-y-6">
								<CliIntroStage
									introBeat={script.cliIntroBeat}
									visibleBeatMap={visibleBeatMap}
								/>
								<SetupChecksStage
									readyAgentNames={setupReadyAgentNames}
									setupChecks={script.setupChecks}
									visibleBeatMap={visibleBeatMap}
								/>
								<CreateSpaceStage
									createSpaceLines={script.createSpaceLines}
									visibleBeatMap={visibleBeatMap}
								/>
								<BringAgentsStage
									bringAgentsLines={script.bringAgentsLines}
									visibleBeatMap={visibleBeatMap}
								/>
								<SpaceConversationStage
									script={script}
									visibleBeatMap={visibleBeatMap}
								/>
							</div>
							<div
								aria-hidden="true"
								className="h-px w-full"
								ref={openMeldContentEndRef}
							/>
						</div>
					}
					openMeldPaneRef={openMeldPaneScrollRef}
					providerPane={
						<ProviderPanelStack
							agentSessions={script.agentSessions}
							closedProviderNames={closedProviderNames}
							onCloseProvider={(profileName) => {
								setClosedProviderNames((previousNames) => {
									if (previousNames.has(profileName)) {
										return previousNames;
									}

									const nextNames = new Set(previousNames);
									nextNames.add(profileName);
									return nextNames;
								});
							}}
							visibleBeatMap={visibleBeatMap}
						/>
					}
					rootScrollRef={workspaceScrollRef}
				/>
			</TerminalWindow>
		</div>
	);
}
