import { cn } from "@openmeld/ui/lib/utils";
import type { KeyboardEventHandler, RefObject } from "react";

import { TerminalCommandText } from "../shared/terminal-command-text";
import { TerminalLine } from "../shared/terminal-line";
import { TypewriterText } from "../shared/typewriter-text";

const PROMPT_HOME = "~";
const PROMPT_TIME = "19:11:23";

type StartCommandStageProps = {
	command: string;
	commandSourceRef?: RefObject<HTMLSpanElement | null>;
	hasCommandDockedToHeader?: boolean;
	isDockingToHeader?: boolean;
	isStarted: boolean;
	onStart: () => void;
	startTriggerRef: RefObject<HTMLButtonElement | null>;
	startPrompt: string;
};

type CommandPreviewLineProps = {
	command: string;
	commandSourceRef?: RefObject<HTMLSpanElement | null>;
	isSourceHidden?: boolean;
	isStarted: boolean;
	isTransitioningToHeader?: boolean;
	time: string;
};

function CommandPreviewLine({
	command,
	commandSourceRef,
	isSourceHidden = false,
	isStarted,
	isTransitioningToHeader = false,
	time,
}: CommandPreviewLineProps) {
	return (
		<div className="motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 flex items-baseline gap-3 font-mono text-[0.95rem] leading-7 motion-safe:animate-in motion-safe:duration-500 motion-reduce:animate-none sm:text-[1rem]">
			<span className="w-5 shrink-0 text-center font-medium text-pink-700 dark:text-pink-400">
				›
			</span>
			<div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
				<span
					className={cn(
						"inline-flex min-w-0",
						isSourceHidden ? "opacity-0" : "opacity-100"
					)}
					ref={commandSourceRef}
				>
					<TypewriterText
						charDelayMs={12}
						isActive={!isStarted}
						renderText={(visibleText) => (
							<TerminalCommandText
								className="cursor-text select-text text-[0.95rem] sm:text-[1rem]"
								command={
									isStarted || isTransitioningToHeader ? command : visibleText
								}
							/>
						)}
						text={command}
					/>
				</span>
				{isStarted || isTransitioningToHeader ? null : (
					<span
						aria-hidden
						className="terminal-demo-cursor motion-reduce:animate-none"
					/>
				)}
				{isStarted || isTransitioningToHeader ? null : (
					<span className="min-w-0 flex-1 select-none truncate text-[0.82rem] text-muted-foreground/52">
						run this command in your terminal
					</span>
				)}
			</div>
			{isStarted || isTransitioningToHeader ? null : (
				<span className="ml-auto shrink-0 text-muted-foreground/70 text-sm">
					{time}
				</span>
			)}
		</div>
	);
}

export function StartCommandStage({
	command,
	commandSourceRef,
	hasCommandDockedToHeader = false,
	isDockingToHeader = false,
	isStarted,
	onStart,
	startTriggerRef,
	startPrompt,
}: StartCommandStageProps) {
	const handleStartPromptKeyDown: KeyboardEventHandler<HTMLButtonElement> = (
		event
	) => {
		if (event.key !== "Enter") {
			return;
		}

		event.preventDefault();
		onStart();
	};

	return (
		<div
			className={cn(
				"relative flex flex-col",
				isStarted ? "shrink-0 gap-0" : "h-full min-h-full flex-1 justify-start"
			)}
		>
			{isStarted ? null : (
				<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
					<button
						aria-label={startPrompt}
						className="pointer-events-auto outline-none"
						onClick={(event) => {
							event.preventDefault();
							event.currentTarget.focus();
							onStart();
						}}
						onKeyDown={handleStartPromptKeyDown}
						ref={startTriggerRef}
						type="button"
					>
						<span className="pointer-events-none border border-border/70 bg-card/80 px-5 py-3 font-geist-pixel-square text-[0.72rem] text-muted-foreground uppercase">
							{startPrompt}
						</span>
					</button>
				</div>
			)}

			{hasCommandDockedToHeader ? null : (
				<div className="space-y-0">
					<TerminalLine
						prefix={PROMPT_HOME}
						prefixTone="accent"
						text=""
						variant="accent"
					/>
					<CommandPreviewLine
						command={command}
						commandSourceRef={commandSourceRef}
						isSourceHidden={isDockingToHeader}
						isStarted={isStarted}
						isTransitioningToHeader={isDockingToHeader}
						time={PROMPT_TIME}
					/>
				</div>
			)}
		</div>
	);
}
