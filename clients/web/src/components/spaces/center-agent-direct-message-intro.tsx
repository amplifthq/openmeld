import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	MagnifyingDock,
	MagnifyingDockItem,
} from "@openmeld/ui/components/magnifying-dock";
import { OpenMeldLetterLogoStrong } from "@openmeld/ui/components/openmeld-letter-logo-strong";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { type ReactNode, useContext } from "react";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	CenterAgentComputerSetupCard,
	type CenterAgentComputerSetupContext,
} from "./center-agent-computer-setup-card";
import { CenterAgentIntroContext } from "./center-agent-intro-context";
import { CenterAgentStarterActions } from "./center-agent-starter-actions";
import { PersonalHomeOrganizationHint } from "./personal-home-organization-hint";

export function CenterAgentDirectMessageIntro(input: {
	computerSetupContext?: CenterAgentComputerSetupContext;
	disabled: boolean;
	isPersonalContext: boolean;
	onSelectStarterAction: (prompt: string) => void;
	onStartComputerSetup: () => void;
	onCloseComputerSetup?: () => void;
	showStarterActions: boolean;
	showStarterComputerSetup: boolean;
}) {
	const organization = useOptionalAppOrganization()?.currentOrganization;
	const presentation = useContext(CenterAgentIntroContext);
	if (presentation === "home") {
		return input.showStarterActions ? (
			<div
				className="mx-auto w-full max-w-3xl space-y-4 py-5"
				data-center-agent-direct-message-intro=""
			>
				<h2 className="text-center font-medium text-lg">
					What would you like to work on?
				</h2>
				<CenterAgentStarterActions
					disabled={input.disabled}
					onConnectComputer={input.onStartComputerSetup}
					onSelect={input.onSelectStarterAction}
					showComputerSetup={false}
				/>
			</div>
		) : null;
	}
	const organizationHeading = organization
		? `What should we work on in ${organization.name}?`
		: "What should we work on?";
	let starterContent: ReactNode = null;
	if (input.showStarterComputerSetup && input.computerSetupContext) {
		starterContent = (
			<CenterAgentComputerSetupCard
				context={input.computerSetupContext}
				onDismiss={input.onCloseComputerSetup}
				target={{ kind: "computer_setup", mode: "setup" }}
			/>
		);
	}
	if (input.showStarterActions) {
		starterContent = (
			<>
				<CenterAgentStarterActions
					disabled={input.disabled}
					onConnectComputer={input.onStartComputerSetup}
					onSelect={input.onSelectStarterAction}
					showAgentLogos={!input.isPersonalContext}
				/>
				{starterContent && <div className="mt-4">{starterContent}</div>}
			</>
		);
	}

	return (
		<div
			className="mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center py-12"
			data-center-agent-direct-message-intro=""
		>
			<div className="flex w-full flex-col items-center gap-4">
				<div className="flex h-20 items-center justify-center text-foreground">
					<OpenMeldLetterLogoStrong
						ariaLabel="OpenMeld O logo"
						pointerTracking="viewport"
						size={10}
					/>
				</div>
				<h2 className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3 text-center font-medium text-2xl text-foreground leading-relaxed">
					{input.isPersonalContext ? (
						<>
							<span>How should we work with your</span>
							<MagnifyingDock
								aria-label="Codex, Claude Code, Grok Build, OpenCode, and Cursor"
								className="items-center gap-0 -space-x-3 px-1"
								magnification={1.3}
								role="group"
							>
								{[
									"codex",
									"claude-code",
									"grok-build",
									"opencode",
									"cursor",
								].map((agentId, index) => (
									<MagnifyingDockItem
										className="h-9 min-h-9 w-9 min-w-9 justify-center"
										key={agentId}
										style={{ zIndex: 5 - index }}
										visualClassName="origin-center"
									>
										<Tooltip>
											<TooltipTrigger
												aria-label={formatLocalAgentDisplayName(agentId)}
												className="flex size-9 items-center justify-center rounded-sm p-0 leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
											>
												<LocalAgentLogo
													agentId={agentId}
													className="size-9 rounded-sm"
													variant="tile"
												/>
											</TooltipTrigger>
											<TooltipContent>
												{formatLocalAgentDisplayName(agentId)}
											</TooltipContent>
										</Tooltip>
									</MagnifyingDockItem>
								))}
							</MagnifyingDock>
							<span>?</span>
						</>
					) : (
						organizationHeading
					)}
				</h2>
				{input.isPersonalContext && <PersonalHomeOrganizationHint />}
				<div className="mt-4 w-full">{starterContent}</div>
			</div>
		</div>
	);
}
