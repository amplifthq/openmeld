"use client";

import { Bars } from "@openmeld/ui/components/bars";
import { Button } from "@openmeld/ui/components/button";
import { CheckIcon } from "@phosphor-icons/react";
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
	const hasInstructions =
		input.title !== undefined ||
		input.description !== undefined ||
		(input.steps !== undefined && input.steps.length > 0);

	return (
		<div className="grid gap-4">
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
					<SetupCommandPlatformSwitch
						onChange={input.onCommandPlatformChange}
						value={input.commandPlatform}
					/>
				) : null}
				<div className="grid gap-2">
					<button
						className="w-full select-all overflow-x-auto whitespace-nowrap rounded-md border border-border bg-muted/10 px-3 py-2 text-left font-mono text-xs transition-colors [scrollbar-width:none] hover:bg-muted/30 lg:max-w-[50vw] [&::-webkit-scrollbar]:hidden"
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
				</div>
				<p className="text-muted-foreground text-xs">
					Copy the command, paste it into{" "}
					{input.commandPlatform === "windows" ? "PowerShell" : "Terminal"}, and
					keep it open while OpenMeld finishes setup.
				</p>
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
		</div>
	);
}

function SetupCommandPlatformSwitch(input: {
	onChange: (platform: WebSetupCommandPlatform) => void;
	value: WebSetupCommandPlatform;
}) {
	return (
		<fieldset
			aria-label="Setup command platform"
			className="flex flex-wrap gap-2"
		>
			<Button
				aria-pressed={input.value === "posix"}
				onClick={() => input.onChange("posix")}
				size="sm"
				type="button"
				variant={input.value === "posix" ? "default" : "outline"}
			>
				macOS / Linux
			</Button>
			<Button
				aria-pressed={input.value === "windows"}
				onClick={() => input.onChange("windows")}
				size="sm"
				type="button"
				variant={input.value === "windows" ? "default" : "outline"}
			>
				Windows PowerShell
			</Button>
		</fieldset>
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
