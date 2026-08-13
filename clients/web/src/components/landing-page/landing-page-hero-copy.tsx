import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";

export const LANDING_PAGE_HERO_HEADING =
	"Open-source operating system for agent-native teams of people and machines.";
export const LANDING_PAGE_HERO_TAGLINE =
	"People and agents, working as one—learning and evolving together.";

export function LandingPageHeroSubtitle(input: { className?: string }) {
	return (
		<p className={input.className} data-testid="landing-hero-summary">
			<span className="block" data-testid="landing-hero-summary-sentence">
				Add the Center Agent to <InlineSlackLogo />
				<span className="sr-only">Slack</span>.
			</span>
			<span className="block" data-testid="landing-hero-summary-sentence">
				It connects the right local agents <InlineLocalAgentLogos />
				<span className="sr-only">
					Claude Code, Codex, Cursor, and OpenCode
				</span>{" "}
				from your team and puts them to work.
			</span>
			<span className="block" data-testid="landing-hero-summary-sentence">
				They learn from your team’s shared memory and context, wherever it
				lives.
			</span>
		</p>
	);
}

export function InlineLocalAgentLogos() {
	return (
		<span
			aria-hidden="true"
			className="inline-flex translate-y-[0.1em] items-center gap-2 px-1"
		>
			<LocalAgentLogo
				agentId="builtin:claude-code"
				className="h-[1em] w-[1em]"
				size="sm"
			/>
			<LocalAgentLogo
				agentId="builtin:codex"
				className="h-[1em] w-[1em]"
				size="sm"
			/>
			<LocalAgentLogo
				agentId="builtin:cursor"
				className="h-[1em] w-[1em]"
				size="sm"
			/>
			<LocalAgentLogo
				agentId="builtin:opencode"
				className="h-[1em] w-[1em]"
				size="sm"
			/>
		</span>
	);
}

export function SlackMarkIcon(input: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={input.className}
			data-testid="slack-mark-icon"
			viewBox="0 0 632.6 632.6"
			xmlns="http://www.w3.org/2000/svg"
		>
			<SlackMarkPaths />
		</svg>
	);
}

function InlineSlackLogo() {
	return (
		<span
			aria-hidden="true"
			className="inline-flex translate-y-[0.1em] items-center px-1.5"
		>
			<svg
				className="h-[1em] w-auto text-foreground"
				data-testid="channel-logo-slack"
				viewBox="0 0 2500 632.6"
				xmlns="http://www.w3.org/2000/svg"
			>
				<title>Slack logo</title>
				<path
					clipRule="evenodd"
					d="m799.8 498.1 31.2-72.5c33.7 25.2 78.6 38.3 122.9 38.3 32.7 0 53.4-12.6 53.4-31.7-.5-53.4-195.9-11.6-197.4-145.5-.5-68 59.9-120.4 145.5-120.4 50.9 0 101.7 12.6 138 41.3l-29.2 74c-33.2-21.2-74.5-36.3-113.8-36.3-26.7 0-44.3 12.6-44.3 28.7.5 52.4 197.4 23.7 199.4 151.6 0 69.5-58.9 118.4-143.5 118.4-62-.1-118.9-14.7-162.2-45.9m1198.1-98.7c-15.6 27.2-44.8 45.8-78.6 45.8-49.9 0-90.1-40.3-90.1-90.1s40.3-90.1 90.1-90.1c33.7 0 63 18.6 78.6 45.8l86.1-47.8c-32.2-57.4-94.2-96.7-164.7-96.7-104.3 0-188.9 84.6-188.9 188.9s84.6 188.9 188.9 188.9c71 0 132.5-38.8 164.7-96.7zm-849.1-389.8h107.8v527.3h-107.8zm977.5 0v527.3h107.8v-158.2l127.9 158.2h138l-162.7-187.9 150.6-175.3h-132l-121.9 145.5v-309.6z"
					data-slack-wordmark=""
					fill="currentColor"
					fillRule="evenodd"
				/>
				<path
					d="m1576.9 400.4c-15.6 25.7-47.8 44.8-84.1 44.8-49.9 0-90.1-40.3-90.1-90.1s40.3-90.1 90.1-90.1c36.3 0 68.5 20.1 84.1 46.3zm0-226.6v42.8c-17.6-29.7-61.4-50.4-107.3-50.4-94.7 0-169.2 83.6-169.2 188.4s74.5 189.4 169.2 189.4c45.8 0 89.6-20.6 107.3-50.4v42.8h107.8v-362.6z"
					data-slack-wordmark=""
					fill="currentColor"
				/>
				<SlackMarkPaths />
			</svg>
		</span>
	);
}

function SlackMarkPaths() {
	return (
		<g clipRule="evenodd" fillRule="evenodd">
			<path
				d="m133.5 399.9c0 36.8-29.7 66.5-66.5 66.5s-66.5-29.8-66.5-66.5 29.7-66.5 66.5-66.5h66.5zm33.2 0c0-36.8 29.7-66.5 66.5-66.5s66.5 29.7 66.5 66.5v166.2c0 36.8-29.7 66.5-66.5 66.5s-66.5-29.7-66.5-66.5z"
				fill="#e01e5a"
			/>
			<path
				d="m233.2 133c-36.8 0-66.5-29.7-66.5-66.5s29.7-66.5 66.5-66.5 66.5 29.7 66.5 66.5v66.5zm0 33.7c36.8 0 66.5 29.7 66.5 66.5s-29.7 66.5-66.5 66.5h-166.7c-36.8 0-66.5-29.8-66.5-66.5s29.7-66.5 66.5-66.5z"
				fill="#36c5f0"
			/>
			<path
				d="m499.6 233.2c0-36.8 29.7-66.5 66.5-66.5s66.5 29.7 66.5 66.5-29.7 66.5-66.5 66.5h-66.5zm-33.2 0c0 36.8-29.7 66.5-66.5 66.5s-66.5-29.7-66.5-66.5v-166.7c0-36.8 29.7-66.5 66.5-66.5s66.5 29.7 66.5 66.5z"
				fill="#2eb67d"
			/>
			<path
				d="m399.9 499.6c36.8 0 66.5 29.7 66.5 66.5s-29.7 66.5-66.5 66.5-66.5-29.7-66.5-66.5v-66.5zm0-33.2c-36.8 0-66.5-29.7-66.5-66.5s29.7-66.5 66.5-66.5h166.7c36.8 0 66.5 29.7 66.5 66.5s-29.7 66.5-66.5 66.5z"
				fill="#ecb22e"
			/>
		</g>
	);
}
