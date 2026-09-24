import { env } from "#/env";
import { copyTextToClipboard } from "#/lib/clipboard";
import {
	resolveWebCliTarget,
	type WebCliTarget,
	type WebCliTargetInput,
	type WebSetupUserFacingCommand,
} from "./web-cli-target";

export type { WebSetupUserFacingCommand } from "./web-cli-target";

const DEFAULT_GATEWAY_URL = "https://gateway.openmeld.ai";
const RELEASE_SETUP_BOOTSTRAP_ORIGIN = "https://openmeld.ai";
const LOCAL_SETUP_BOOTSTRAP_ORIGIN = "http://localhost:3000";
const HTTP_ORIGIN_RE = /^https?:/u;
const OPENMELD_COMMAND_PREFIX_RE = /^openmeld(?=$|\s)/u;
const SAFE_SHELL_WORD_RE = /^[A-Za-z0-9_./:@%+=,-]+$/u;
const BASE64_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const POSIX_SETUP_DOWNLOAD_SCRIPT = `setup_file=$(mktemp "\${TMPDIR:-/tmp}/openmeld-setup.XXXXXX") || exit 1; trap 'rm -f "$setup_file"' EXIT; curl -fsSL --connect-timeout 10 --speed-limit 1 --speed-time 30 -o "$setup_file" "$1" || exit 1; [ -s "$setup_file" ] || { echo 'OpenMeld setup download was empty.' >&2; exit 1; }; shift; sh "$setup_file" "$@"`;

export type WebSetupCommandPlatform = "posix" | "windows";

type SetupBootstrapLane = "prod" | "dev-local" | "canary";

export function resolveWebCliEntryCommand(input?: WebCliTargetInput): string {
	return prefixTargetEnvironment(resolveWebCliTarget(input));
}

export function resolveWebSetupFollowUpCliCommandPrefix(
	input?: WebCliTargetInput
): string {
	const entryCommand = resolveWebCliEntryCommand(input);
	return entryCommand;
}

export function formatWebCliCommand(
	command: string,
	input?: WebCliTargetInput
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
	deviceCode?: string;
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

export function resolveWebStartCommand(input?: WebCliTargetInput): string {
	return `${resolveWebCliEntryCommand(input)} start`;
}

export function resolveWebSetupCommand(input?: WebCliTargetInput): string {
	return `${resolveWebCliEntryCommand(input)} setup`;
}

export function resolveWebServiceStopCommand(
	input?: WebCliTargetInput
): string {
	return `${resolveWebCliEntryCommand(input)} service stop`;
}

export function buildWebSetupCommand(input: WebSetupCommandInput = {}): string {
	// OPENMELD_SETUP_TO_WAKE_PATH: RECOMMENDED_ENTRY generated-setup-command
	// This is the Web-generated command handoff. It is a convenience surface;
	// the canonical path begins when a human or agent runs the command locally.
	const target = resolveWebCliTarget(input);
	const setupInput: WebSetupCommandInput = {
		...input,
		userFacingCommand: target.userFacingCommand,
		openMeldHome: target.openMeldHome,
		authUrl: target.authUrl,
		gatewayUrl: target.gatewayUrl,
	};
	const modeCount = [
		setupInput.humanProfileId ? 1 : 0,
		setupInput.startSession ? 1 : 0,
		setupInput.agentIds?.length ? 1 : 0,
		setupInput.agentProfileId ? 1 : 0,
	].reduce((total, value) => total + value, 0);

	if (modeCount > 1) {
		throw new Error(
			"OpenMeld can only build one setup command mode at a time."
		);
	}
	if (setupInput.localAgents && setupInput.localAgentIds?.length) {
		throw new Error(
			"OpenMeld can only build one local agent selection mode at a time."
		);
	}

	const oneTimeToken = normalizeOptionalString(setupInput.oneTimeToken);
	const deviceCode = normalizeOptionalString(setupInput.deviceCode);
	if (oneTimeToken && deviceCode) {
		throw new Error("OpenMeld can only use one setup sign-in grant at a time.");
	}
	const bootstrapCommand = resolveSetupBootstrapCommand(
		setupInput,
		oneTimeToken,
		deviceCode
	);
	if (bootstrapCommand) {
		return bootstrapCommand;
	}

	return [
		resolveWebSetupCommand({
			openMeldHome: setupInput.openMeldHome,
			authUrl: setupInput.authUrl,
			gatewayUrl: setupInput.gatewayUrl,
			userFacingCommand: setupInput.userFacingCommand,
		}),
		...buildSetupArguments(setupInput, oneTimeToken, deviceCode).map(
			formatShellWord
		),
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

function prefixTargetEnvironment(target: WebCliTarget): string {
	const assignments: [string, string][] = [];
	if (
		target.authUrl &&
		target.authUrl !== target.defaultAuthUrl &&
		!target.productionBootstrap
	) {
		assignments.push(["OPENMELD_AUTH_URL", target.authUrl]);
	}
	if (target.gatewayUrl && target.gatewayUrl !== DEFAULT_GATEWAY_URL) {
		assignments.push(["OPENMELD_GATEWAY_URL", target.gatewayUrl]);
	}
	if (target.openMeldHome) {
		assignments.push(["OPENMELD_HOME", target.openMeldHome]);
	}
	if (target.isolatedLane && target.manifestUrl) {
		assignments.push(["OPENMELD_CLI_BINARY_MANIFEST_URL", target.manifestUrl]);
	}
	return prefixShellEnvironmentAssignments(target.entryCommand, assignments);
}

function resolveSetupBootstrapCommand(
	input: WebSetupCommandInput,
	oneTimeToken: string | null,
	deviceCode: string | null
): string | null {
	// OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT setup-handoff-token
	// The Prepare token and short-lived sign-in grant are the narrow handoff
	// facts that let Web pass setup to a local Terminal, human, or agent.
	if (!(input.startSession && (oneTimeToken || deviceCode))) {
		return null;
	}
	const lane = resolveSetupBootstrapLane(input);
	if (!lane) {
		return null;
	}

	const platform = input.setupPlatform ?? "posix";
	const args = [
		"setup",
		...buildSetupArguments(input, oneTimeToken, deviceCode),
	];
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

	return `sh -c ${formatShellWord(POSIX_SETUP_DOWNLOAD_SCRIPT)} sh ${formatShellWord(setupUrl)} ${args
		.map(formatShellWord)
		.join(" ")}`;
}

function resolveSetupBootstrapLane(
	input: WebSetupCommandInput
): SetupBootstrapLane | null {
	const target = resolveWebCliTarget(input);
	return target.lane === "prod" && !target.productionBootstrap
		? null
		: target.lane;
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
	} else if (input.lane === "canary") {
		url.searchParams.set("dist", "binary");
	}
	if (input.lane !== "prod") {
		url.searchParams.set("lane", input.lane);
		const openMeldHome = normalizeOptionalString(input.openMeldHome);
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

	const configuredOrigin = env.VITE_OPENMELD_WEB_URL;
	if (configuredOrigin) {
		return new URL(configuredOrigin).origin;
	}
	if (
		typeof window !== "undefined" &&
		HTTP_ORIGIN_RE.test(window.location.origin)
	) {
		return window.location.origin;
	}

	return LOCAL_SETUP_BOOTSTRAP_ORIGIN;
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
	oneTimeToken: string | null,
	deviceCode: string | null
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
	if (deviceCode) {
		args.push("--device-code", deviceCode);
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
