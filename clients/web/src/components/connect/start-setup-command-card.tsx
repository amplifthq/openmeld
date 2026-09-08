"use client";

import "./setup-instructions.css";

import { Bars } from "@openmeld/ui/components/bars";
import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { TabItem, TabPanel, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CheckIcon,
	CopyIcon,
	ListChecksIcon,
	TerminalIcon,
} from "@phosphor-icons/react";
import { TextShimmer } from "#/components/motion-primitives/text-shimmer";
import type { WebSetupCommandPlatform } from "#/lib/cli-entry-command";

export const OPENMELD_SETUP_TERMINAL_CONFIRMATION_STEP =
	"If Terminal asks you to accept the OpenMeld disclaimer or install missing OpenMeld skills, choose the recommended options.";

type StartSetupCommandCardProps = {
	command: string | null;
	commandPlaceholder: string;
	commandPlatform?: WebSetupCommandPlatform;
	copyLabel: string;
	copyStatus: "idle" | "copied" | "manual";
	description?: string;
	expiresInLabel: string | null;
	expiresInState?: "expired" | "normal";
	isChecking?: boolean;
	isLoading: boolean;
	isRefreshingExpiredCommand?: boolean;
	onCommandPlatformChange?: (platform: WebSetupCommandPlatform) => void;
	onCopyCommand: () => Promise<void>;
	onCheckNow?: () => Promise<void>;
	onRefreshExpiredCommand?: () => Promise<void>;
	secondaryStatusText?: string | null;
	statusText?: string | null;
	statusTextIsShimmering?: boolean;
	steps?: readonly string[];
	title?: string;
};

type StartSetupCommandStatusProps = {
	secondaryStatusText?: string | null;
	statusText: string | null | undefined;
	statusTextIsShimmering?: boolean;
};

type StartSetupCommandExpiryProps = {
	expiresInLabel: string | null;
	expiresInState?: "expired" | "normal";
	isRefreshingExpiredCommand?: boolean;
	onRefreshExpiredCommand?: () => Promise<void>;
};

export function StartSetupCommandCard(input: StartSetupCommandCardProps) {
	const platform = input.commandPlatform ?? "posix";
	const hasInstructions =
		input.title !== undefined ||
		input.description !== undefined ||
		(input.steps !== undefined && input.steps.length > 0);

	return (
		<Tabs
			className="grid gap-4"
			onValueChange={(value) =>
				input.onCommandPlatformChange?.(value as WebSetupCommandPlatform)
			}
			value={platform}
		>
			{hasInstructions ? (
				<div className="grid gap-3">
					{input.title ? (
						<h3 className="font-medium text-foreground text-sm">
							{input.title}
						</h3>
					) : null}
					{input.description ? (
						<p className="text-muted-foreground text-sm">{input.description}</p>
					) : null}
					{input.steps?.length ? (
						<div className="grid gap-2 text-muted-foreground text-sm">
							{input.steps.map((step, index) => (
								<p key={step}>{`${index + 1}. ${step}`}</p>
							))}
						</div>
					) : null}
				</div>
			) : null}
			<div className="grid gap-3">
				{input.commandPlatform && input.onCommandPlatformChange ? (
					<SetupCommandPlatformSwitch />
				) : null}
				<TabPanel className="grid gap-2" value={platform}>
					<button
						className="w-full min-w-0 touch-manipulation select-all overflow-x-auto whitespace-nowrap rounded-md border border-border bg-muted/10 px-3 py-2 text-left font-mono text-xs transition-colors [scrollbar-width:none] hover:bg-muted/30 max-lg:min-h-11 [&::-webkit-scrollbar]:hidden"
						onClick={input.onCopyCommand}
						type="button"
					>
						{input.command ??
							(input.isLoading ? (
								<span className="inline-flex items-center gap-2">
									<Bars className="h-4 w-6" />
									{input.commandPlaceholder}
								</span>
							) : (
								input.commandPlaceholder
							))}
					</button>
					<div className="flex flex-wrap gap-3">
						<Button
							disabled={!input.command || input.isLoading}
							onClick={input.onCopyCommand}
							type="button"
							variant="outline"
						>
							{input.copyStatus === "copied" ? (
								<CheckIcon
									aria-hidden="true"
									data-icon="inline-start"
									weight="bold"
								/>
							) : null}
							{input.copyStatus === "copied" ? "Copied" : input.copyLabel}
						</Button>
					</div>
				</TabPanel>
				<ol className="grid gap-2 text-xs sm:grid-cols-3">
					<li
						className={cn(
							"rounded-md border border-transparent p-3",
							surfaceClasses(1)
						)}
					>
						<CopyIcon
							aria-hidden="true"
							className="setup-instruction-icon mb-2 size-5 text-muted-foreground"
						/>
						<span className="font-medium">1. Copy the command</span>
						<p className="mt-1 text-muted-foreground">
							Use the copy button above.
						</p>
					</li>
					<li
						className={cn(
							"rounded-md border border-transparent p-3",
							surfaceClasses(1)
						)}
					>
						<TerminalIcon
							aria-hidden="true"
							className="setup-instruction-icon mb-2 size-5 text-muted-foreground"
						/>
						<span className="font-medium">
							2. Open{" "}
							{input.commandPlatform === "windows" ? "PowerShell" : "Terminal"}
						</span>
						<p className="mt-1 text-muted-foreground">
							Paste the command and press Return.
						</p>
					</li>
					<li
						className={cn(
							"rounded-md border border-transparent p-3",
							surfaceClasses(1)
						)}
					>
						<ListChecksIcon
							aria-hidden="true"
							className="setup-instruction-icon mb-2 size-5 text-muted-foreground"
						/>
						<span className="font-medium">3. Follow the prompts</span>
						<p className="mt-1 text-muted-foreground">
							Keep it open. This page updates as you connect.
						</p>
					</li>
				</ol>
				<StartSetupCommandExpiry
					expiresInLabel={input.expiresInLabel}
					expiresInState={input.expiresInState}
					isRefreshingExpiredCommand={input.isRefreshingExpiredCommand}
					onRefreshExpiredCommand={input.onRefreshExpiredCommand}
				/>
				<StartSetupCommandStatus
					secondaryStatusText={input.secondaryStatusText}
					statusText={input.statusText}
					statusTextIsShimmering={input.statusTextIsShimmering}
				/>
				{input.copyStatus === "manual" ? (
					<p className="text-muted-foreground text-xs">
						OpenMeld could not copy automatically. Select the command text, copy
						it manually, and paste it into Terminal.
					</p>
				) : null}
				{input.onCheckNow ? (
					<div className="flex flex-wrap gap-3">
						<Button
							disabled={input.isChecking === true}
							onClick={input.onCheckNow}
							type="button"
							variant="outline"
						>
							Check now
						</Button>
					</div>
				) : null}
			</div>
		</Tabs>
	);
}

function SetupCommandPlatformSwitch() {
	return (
		<TabsList
			aria-label="Setup command platform"
			background={false}
			className="w-fit"
		>
			<TabItem label="macOS / Linux" value="posix" />
			<TabItem
				aria-label="Windows PowerShell"
				label="Windows PowerShell"
				value="windows"
			>
				Windows PowerShell
				<Tooltip>
					<TooltipTrigger
						render={
							<span className="rounded px-1 font-normal text-[10px] opacity-70">
								Beta
							</span>
						}
					/>
					<TooltipContent className="max-w-64 whitespace-normal">
						Windows setup is in beta. Some steps may need manual
						troubleshooting.
					</TooltipContent>
				</Tooltip>
			</TabItem>
		</TabsList>
	);
}

function StartSetupCommandExpiry(input: StartSetupCommandExpiryProps) {
	if (!input.expiresInLabel) {
		return null;
	}

	return (
		<div className="flex flex-wrap items-center gap-3">
			<p
				className={
					input.expiresInState === "expired"
						? "text-destructive text-xs"
						: "text-muted-foreground text-xs"
				}
			>
				{input.expiresInLabel}
			</p>
			{input.onRefreshExpiredCommand ? (
				<Button
					disabled={input.isRefreshingExpiredCommand === true}
					onClick={input.onRefreshExpiredCommand}
					size="sm"
					type="button"
					variant="outline"
				>
					{input.isRefreshingExpiredCommand
						? "Refreshing command"
						: "Refresh command"}
				</Button>
			) : null}
		</div>
	);
}

function StartSetupCommandStatus(input: StartSetupCommandStatusProps) {
	if (!input.statusText) {
		return null;
	}

	return (
		<div className="mt-1 grid gap-1">
			{input.statusTextIsShimmering ? (
				<TextShimmer as="p" className="text-sm" duration={1.8}>
					{input.statusText}
				</TextShimmer>
			) : (
				<p className="text-muted-foreground text-sm">{input.statusText}</p>
			)}
			{input.secondaryStatusText ? (
				<p className="text-muted-foreground text-xs">
					{input.secondaryStatusText}
				</p>
			) : null}
		</div>
	);
}
