import { env } from "#/env";
import { copyTextToClipboard } from "#/lib/clipboard";

const DEFAULT_GATEWAY_URL = "https://gateway.openmeld.ai";
const DEFAULT_RELEASE_AUTH_URL = "https://auth.openmeld.ai";
const DEFAULT_DEV_AUTH_URL = "http://localhost:8788";
const DEV_CLI_ENTRY_COMMAND = "openmeld-dev";
const CANARY_CLI_ENTRY_COMMAND = "openmeld-canary";
const RELEASE_CLI_ENTRY_COMMAND = "npx -y openmeld@latest";
const RELEASE_SETUP_BOOTSTRAP_ORIGIN = "https://openmeld.ai";
const LOCAL_SETUP_BOOTSTRAP_ORIGIN = "http://localhost:3000";
const DEV_START_COMMAND = `${DEV_CLI_ENTRY_COMMAND} start`;
const RELEASE_START_COMMAND = `${RELEASE_CLI_ENTRY_COMMAND} start`;
const DEV_SETUP_COMMAND = `${DEV_CLI_ENTRY_COMMAND} setup`;
const RELEASE_SETUP_COMMAND = `${RELEASE_CLI_ENTRY_COMMAND} setup`;
const DEV_SERVICE_STOP_COMMAND = `${DEV_CLI_ENTRY_COMMAND} service stop`;
const RELEASE_SERVICE_STOP_COMMAND = `${RELEASE_CLI_ENTRY_COMMAND} service stop`;
const OPENMELD_COMMAND_PREFIX_RE = /^openmeld(?=$|\s)/u;
const SAFE_SHELL_WORD_RE = /^[A-Za-z0-9_./:@%+=,-]+$/u;
const BASE64_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

type CommandEnvironmentInput = {
	openMeldHome?: string;
	authUrl?: string;
	gatewayUrl?: string;
};

export type WebSetupCommandPlatform = "posix" | "windows";

type SetupBootstrapLane = "prod" | "dev-local" | "canary";

export type WebSetupUserFacingCommand =
	| "openmeld"
	| "openmeld-dev"
	| "openmeld-canary";

export function resolveWebCliEntryCommand(input?: {
	runtimeLane?: string;
	userFacingCommand?: WebSetupUserFacingCommand;
}): string {
	const userFacingCommand =
		input?.userFacingCommand ??
		resolveWebUserFacingCommandFromRuntimeLane(input?.runtimeLane);

	if (userFacingCommand === "openmeld-dev") {
		return DEV_CLI_ENTRY_COMMAND;
	}
	if (userFacingCommand === "openmeld-canary") {
		return CANARY_CLI_ENTRY_COMMAND;
	}
	if (userFacingCommand === "openmeld") {
		return RELEASE_CLI_ENTRY_COMMAND;
	}

	return import.meta.env.DEV
		? DEV_CLI_ENTRY_COMMAND
		: RELEASE_CLI_ENTRY_COMMAND;
}

export function resolveWebSetupFollowUpCliCommandPrefix(input?: {
	runtimeLane?: string;
	userFacingCommand?: WebSetupUserFacingCommand;
}): string {
	const entryCommand = resolveWebCliEntryCommand(input);
	return entryCommand;
}

export function formatWebCliCommand(
	command: string,
	input?: {
		runtimeLane?: string;
		userFacingCommand?: WebSetupUserFacingCommand;
	}
): string {
	if (!OPENMELD_COMMAND_PREFIX_RE.test(command)) {
		return command;
	}

	return command.replace(
		OPENMELD_COMMAND_PREFIX_RE,
		resolveWebCliEntryCommand(input)
	);
}

type WebSetupCommandInput = {
	agentIds?: readonly string[];
	agentProfileId?: string;
	openMeldHome?: string;
	authUrl?: string;
	gatewayUrl?: string;
	humanProfileId?: string;
	localAgentIds?: readonly string[];
	localAgents?: "all" | "none";
	oneTimeToken?: string;
	resetThisComputer?: boolean;
	setupPlatform?: WebSetupCommandPlatform;
	startSession?: string;
	userFacingCommand?: WebSetupUserFacingCommand;
	view?: "agent" | "human";
};

export function resolveWebStartCommand(input?: {
	openMeldHome?: string;
	authUrl?: string;
	gatewayUrl?: string;
}): string {
	const isDevCommand = import.meta.env.DEV;
	const baseCommand = isDevCommand ? DEV_START_COMMAND : RELEASE_START_COMMAND;

	return prefixCommandEnvironment(baseCommand, {
		openMeldHome: input?.openMeldHome,
		authUrl: input?.authUrl,
		defaultAuthUrl: resolveDefaultAuthUrl({ isDevCommand }),
		gatewayUrl: input?.gatewayUrl,
		includeOpenMeldHome: isDevCommand,
		shouldPrefixEnvironment: isDevCommand,
	});
}

export function resolveWebSetupCommand(input?: {
	openMeldHome?: string;
	authUrl?: string;
	gatewayUrl?: string;
	userFacingCommand?: WebSetupUserFacingCommand;
}): string {
	const commandTarget = resolveSetupCommandTarget(input?.userFacingCommand);

	return prefixCommandEnvironment(commandTarget.baseCommand, {
		openMeldHome: input?.openMeldHome,
		authUrl: input?.authUrl,
		defaultAuthUrl: commandTarget.defaultAuthUrl,
		gatewayUrl: input?.gatewayUrl,
		includeOpenMeldHome: commandTarget.includeOpenMeldHome,
		shouldPrefixEnvironment: commandTarget.shouldPrefixEnvironment,
	});
}

export function resolveWebServiceStopCommand(input?: {
	openMeldHome?: string;
}): string {
	const isDevCommand = import.meta.env.DEV;
	const baseCommand = isDevCommand
		? DEV_SERVICE_STOP_COMMAND
		: RELEASE_SERVICE_STOP_COMMAND;

	return prefixCommandEnvironment(baseCommand, {
		openMeldHome: input?.openMeldHome,
		defaultAuthUrl: resolveDefaultAuthUrl({ isDevCommand }),
		includeOpenMeldHome: isDevCommand,
		shouldPrefixEnvironment: isDevCommand,
	});
}

export function buildWebSetupCommand(input: WebSetupCommandInput = {}): string {
	// OPENMELD_SETUP_TO_WAKE_PATH: RECOMMENDED_ENTRY generated-setup-command
	// This is the Web-generated command handoff. It is a convenience surface;
	// the canonical path begins when a human or agent runs the command locally.
	const modeCount = [
		input.humanProfileId ? 1 : 0,
		input.startSession ? 1 : 0,
		input.agentIds?.length ? 1 : 0,
		input.agentProfileId ? 1 : 0,
	].reduce((total, value) => total + value, 0);

	if (modeCount > 1) {
		throw new Error(
			"OpenMeld can only build one setup command mode at a time."
		);
	}
	if (input.localAgents && input.localAgentIds?.length) {
		throw new Error(
			"OpenMeld can only build one local agent selection mode at a time."
		);
	}

	const oneTimeToken = normalizeOptionalString(input.oneTimeToken);
	const bootstrapCommand = resolveSetupBootstrapCommand(input, oneTimeToken);
	if (bootstrapCommand) {
		return bootstrapCommand;
	}

	return [
		resolveWebSetupCommand({
			openMeldHome: input.openMeldHome,
			authUrl: input.authUrl,
			gatewayUrl: input.gatewayUrl,
			userFacingCommand: input.userFacingCommand,
		}),
		...buildSetupArguments(input, oneTimeToken),
	]
		.filter(Boolean)
		.join(" ");
}

export function resolveBrowserSetupCommandPlatform(input?: {
	platform?: string;
	userAgent?: string;
}): WebSetupCommandPlatform {
	const browserText = `${input?.platform ?? resolveNavigatorPlatform()} ${
		input?.userAgent ?? resolveNavigatorUserAgent()
	}`.toLowerCase();
	return browserText.includes("win") ? "windows" : "posix";
}

export function resolveWebAgentsRepairCommand(input: {
	agentIds: readonly string[];
	openMeldHome?: string;
	authUrl?: string;
	gatewayUrl?: string;
	userFacingCommand?: WebSetupUserFacingCommand;
}): string {
	return buildWebSetupCommand({
		agentIds: input.agentIds,
		openMeldHome: input.openMeldHome,
		authUrl: input.authUrl,
		gatewayUrl: input.gatewayUrl,
		userFacingCommand: input.userFacingCommand,
	});
}

export function resolveWebAgentProfileSetupCommand(input: {
	agentProfileId: string;
	openMeldHome?: string;
	authUrl?: string;
	gatewayUrl?: string;
	oneTimeToken?: string;
	userFacingCommand?: WebSetupUserFacingCommand;
}): string {
	return buildWebSetupCommand({
		agentProfileId: input.agentProfileId,
		openMeldHome: input.openMeldHome,
		authUrl: input.authUrl,
		gatewayUrl: input.gatewayUrl,
		oneTimeToken: input.oneTimeToken,
		userFacingCommand: input.userFacingCommand,
	});
}

export async function copyCliEntryCommand(command: string): Promise<boolean> {
	return await copyTextToClipboard(command);
}

function prefixCommandEnvironment(
	baseCommand: string,
	input: CommandEnvironmentInput & {
		defaultAuthUrl: string;
		includeOpenMeldHome: boolean;
		shouldPrefixEnvironment: boolean;
	}
): string {
	const envAssignments: [string, string][] = [];

	const authUrl = normalizeOptionalString(
		input.authUrl ?? env.VITE_BETTER_AUTH_URL
	);
	if (authUrl && authUrl !== input.defaultAuthUrl) {
		envAssignments.push(["OPENMELD_AUTH_URL", authUrl]);
	}

	const gatewayUrl = normalizeOptionalString(input.gatewayUrl);
	if (gatewayUrl && gatewayUrl !== DEFAULT_GATEWAY_URL) {
		envAssignments.push(["OPENMELD_GATEWAY_URL", gatewayUrl]);
	}

	const openMeldHome = normalizeOptionalString(
		input.openMeldHome ?? env.VITE_OPENMELD_HOME
	);
	if (input.includeOpenMeldHome && openMeldHome) {
		envAssignments.push(["OPENMELD_HOME", openMeldHome]);
	}

	return input.shouldPrefixEnvironment
		? prefixShellEnvironmentAssignments(baseCommand, envAssignments)
		: baseCommand;
}

function resolveSetupCommandTarget(
	userFacingCommand: WebSetupUserFacingCommand | undefined
): {
	baseCommand: string;
	defaultAuthUrl: string;
	includeOpenMeldHome: boolean;
	shouldPrefixEnvironment: boolean;
} {
	if (userFacingCommand) {
		const usesLocalAuthDefault = userFacingCommand !== "openmeld";
		return {
			baseCommand: `${resolveWebCliEntryCommand({
				userFacingCommand,
			})} setup`,
			defaultAuthUrl: usesLocalAuthDefault
				? DEFAULT_DEV_AUTH_URL
				: DEFAULT_RELEASE_AUTH_URL,
			includeOpenMeldHome: false,
			shouldPrefixEnvironment: true,
		};
	}

	const isDevCommand = import.meta.env.DEV;
	return {
		baseCommand: isDevCommand ? DEV_SETUP_COMMAND : RELEASE_SETUP_COMMAND,
		defaultAuthUrl: resolveDefaultAuthUrl({ isDevCommand }),
		includeOpenMeldHome: isDevCommand,
		shouldPrefixEnvironment: isDevCommand,
	};
}

function resolveDefaultAuthUrl(input: { isDevCommand: boolean }): string {
	return input.isDevCommand ? DEFAULT_DEV_AUTH_URL : DEFAULT_RELEASE_AUTH_URL;
}

function resolveSetupBootstrapCommand(
	input: WebSetupCommandInput,
	oneTimeToken: string | null
): string | null {
	// OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT setup-handoff-token
	// The start-session token and one-time sign-in token are the narrow handoff
	// facts that let Web pass setup to a local terminal, human, or agent.
	if (!(input.startSession && oneTimeToken)) {
		return null;
	}
	const lane = resolveSetupBootstrapLane(input);
	if (!lane) {
		return null;
	}

	const platform = input.setupPlatform ?? "posix";
	const args = ["setup", ...buildSetupArguments(input, oneTimeToken)];
	const setupUrl = buildSetupBootstrapUrl({
		openMeldHome: input.openMeldHome,
		lane,
		platform,
	});

	if (platform === "windows") {
		const commandBody = `& ([scriptblock]::Create((irm ${formatPowerShellString(
			setupUrl
		)}))) ${args.map(formatPowerShellString).join(" ")}`;
		return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodePowerShellCommand(
			commandBody
		)}`;
	}

	return `curl -fsSL ${formatShellWord(setupUrl)} | sh -s -- ${args
		.map(formatShellWord)
		.join(" ")}`;
}

function resolveSetupBootstrapLane(
	input: WebSetupCommandInput
): SetupBootstrapLane | null {
	if (input.userFacingCommand === "openmeld-dev") {
		return "dev-local";
	}
	if (input.userFacingCommand === "openmeld-canary") {
		return "canary";
	}
	if (input.userFacingCommand === "openmeld") {
		return hasDefaultProductionSetupTarget(input) ? "prod" : null;
	}
	if (import.meta.env.DEV) {
		return "dev-local";
	}

	return hasDefaultProductionSetupTarget(input) ? "prod" : null;
}

function hasDefaultProductionSetupTarget(input: WebSetupCommandInput): boolean {
	const gatewayUrl = normalizeOptionalString(input.gatewayUrl);
	if (gatewayUrl && gatewayUrl !== DEFAULT_GATEWAY_URL) {
		return false;
	}

	const authUrl = normalizeOptionalString(input.authUrl);
	if (authUrl && authUrl !== DEFAULT_RELEASE_AUTH_URL) {
		return false;
	}

	return true;
}

function buildSetupBootstrapUrl(input: {
	openMeldHome: string | undefined;
	lane: SetupBootstrapLane;
	platform: WebSetupCommandPlatform;
}): string {
	const url = new URL("/setup", resolveSetupBootstrapOrigin(input.lane));
	if (input.platform === "windows") {
		url.searchParams.set("platform", "windows");
		url.searchParams.set("dist", "npm");
	}
	if (input.lane !== "prod") {
		url.searchParams.set("lane", input.lane);
		const openMeldHome = normalizeOptionalString(
			input.openMeldHome ?? env.VITE_OPENMELD_HOME
		);
		if (openMeldHome) {
			url.searchParams.set("openMeldHome", openMeldHome);
		}
	}

	return url.toString();
}

function resolveSetupBootstrapOrigin(lane: SetupBootstrapLane): string {
	if (lane === "prod") {
		return RELEASE_SETUP_BOOTSTRAP_ORIGIN;
	}

	if (typeof window !== "undefined" && window.location.origin) {
		return window.location.origin;
	}

	return LOCAL_SETUP_BOOTSTRAP_ORIGIN;
}

function resolveWebUserFacingCommandFromRuntimeLane(
	runtimeLane: string | undefined
): WebSetupUserFacingCommand | undefined {
	if (runtimeLane === "dev-local" || runtimeLane === "openmeld-dev") {
		return "openmeld-dev";
	}
	if (runtimeLane === "canary" || runtimeLane === "openmeld-canary") {
		return "openmeld-canary";
	}
	if (runtimeLane === "prod" || runtimeLane === "openmeld") {
		return "openmeld";
	}
	return undefined;
}

function normalizeOptionalString(value: string | undefined): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}

function prefixShellEnvironmentAssignments(
	command: string,
	envAssignments: readonly (readonly [string, string])[]
): string {
	if (envAssignments.length === 0) {
		return command;
	}
	return `${envAssignments
		.map(([name, value]) => `${name}=${formatShellWord(value)}`)
		.reverse()
		.join(" ")} ${command}`;
}

function formatShellWord(value: string): string {
	if (SAFE_SHELL_WORD_RE.test(value)) {
		return value;
	}
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatPowerShellString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function encodePowerShellCommand(value: string): string {
	const bytes: number[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		bytes.push(codeUnit % 256, Math.floor(codeUnit / 256));
	}
	return base64EncodeBytes(bytes);
}

function base64EncodeBytes(bytes: readonly number[]): string {
	let output = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index] ?? 0;
		const second = bytes[index + 1] ?? 0;
		const third = bytes[index + 2] ?? 0;
		const remaining = bytes.length - index;
		const triplet = first * 65_536 + second * 256 + third;

		output += BASE64_ALPHABET[Math.floor(triplet / 262_144) % 64];
		output += BASE64_ALPHABET[Math.floor(triplet / 4096) % 64];
		output +=
			remaining > 1 ? BASE64_ALPHABET[Math.floor(triplet / 64) % 64] : "=";
		output += remaining > 2 ? BASE64_ALPHABET[triplet % 64] : "=";
	}
	return output;
}

function buildSetupArguments(
	input: WebSetupCommandInput,
	oneTimeToken: string | null
): string[] {
	const args: string[] = [];
	if (input.humanProfileId) {
		args.push("--human-profile", input.humanProfileId);
	}

	const agentProfileId = normalizeOptionalString(input.agentProfileId);
	if (agentProfileId) {
		args.push("--profile", agentProfileId);
	}

	const normalizedAgentIds = normalizeAgentIds(input.agentIds ?? []);
	if (normalizedAgentIds.length > 0) {
		args.push("--agent", ...normalizedAgentIds);
	}

	if (input.startSession) {
		args.push("--start-session", input.startSession);
	}

	if (input.localAgents) {
		args.push("--local-agents", input.localAgents);
	}

	const normalizedLocalAgentIds = normalizeAgentIds(input.localAgentIds ?? []);
	if (normalizedLocalAgentIds.length > 0) {
		args.push("--local-agent", ...normalizedLocalAgentIds);
	}

	if (input.resetThisComputer === true) {
		args.push("--reset-this-computer");
	}

	if (oneTimeToken) {
		args.push("--ott", oneTimeToken);
	}

	args.push("--view", input.view ?? "human");
	return args;
}

function normalizeAgentIds(agentIds: readonly string[]): string[] {
	return [
		...new Set(agentIds.map((agentId) => agentId.trim()).filter(Boolean)),
	];
}

function resolveNavigatorPlatform(): string {
	if (typeof navigator === "undefined") {
		return "";
	}
	return navigator.platform ?? "";
}

function resolveNavigatorUserAgent(): string {
	if (typeof navigator === "undefined") {
		return "";
	}
	return navigator.userAgent ?? "";
}
