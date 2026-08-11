"use client";

import { openCodePermissionConfigSchema } from "@openmeld/schemas";
import type {
	AgentProfileBindingOpenCodePermission,
	OpenCodePermissionAction,
} from "@openmeld/schemas/types";
import { Label } from "@openmeld/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useEffect, useId, useMemo, useState } from "react";

type OpenCodePermissionFieldValue =
	AgentProfileBindingOpenCodePermission | null;
type OpenCodePermissionCommonAction =
	| OpenCodePermissionAction
	| "custom"
	| "default";

const OPEN_CODE_AGENT_CONTROLLER_REF = "builtin:opencode";
const OPEN_CODE_PERMISSION_COMMON_CONTROLS = [
	{
		description: "Controls file edits.",
		key: "edit",
		label: "File changes",
	},
	{
		description: "Controls shell commands.",
		key: "bash",
		label: "Shell commands",
	},
	{
		description: "Controls fetching URLs.",
		key: "webfetch",
		label: "Fetch URLs",
	},
	{
		description: "Controls web search.",
		key: "websearch",
		label: "Web search",
	},
	{
		description: "Controls access outside the project folder.",
		key: "external_directory",
		label: "Outside project folder",
	},
] as const;
const OPEN_CODE_PERMISSION_ACTION_OPTIONS = [
	{
		description: "Use OpenCode's own default behavior for this permission.",
		label: "OpenCode default",
		value: "default",
	},
	{
		description: "Ask before running this action.",
		label: "Ask before running",
		value: "ask",
	},
	{
		description: "Block this action.",
		label: "Deny",
		value: "deny",
	},
	{
		description: "Run this action without asking.",
		label: "Allow without asking",
		value: "allow",
	},
] as const satisfies readonly {
	description: string;
	label: string;
	value: Exclude<OpenCodePermissionCommonAction, "custom">;
}[];

export function OpenCodePermissionsField(input: {
	disabled: boolean;
	onChange: (value: OpenCodePermissionFieldValue) => void;
	value: OpenCodePermissionFieldValue;
}) {
	const baseId = useId();
	const advancedId = `${baseId}-advanced-json`;
	const serializedValue = useMemo(
		() => formatOpenCodePermissionJson(input.value),
		[input.value]
	);
	const [advancedJson, setAdvancedJson] = useState(serializedValue);
	const [advancedError, setAdvancedError] = useState<string | null>(null);

	useEffect(() => {
		setAdvancedJson(serializedValue);
		setAdvancedError(null);
	}, [serializedValue]);

	return (
		<div className="grid gap-3" data-testid="opencode-permissions-field">
			<div className="grid gap-1">
				<p className="font-medium text-sm">OpenCode permissions</p>
				<p className="text-muted-foreground text-xs leading-5">
					Common choices use OpenCode's official permission keys. Advanced JSON
					is passed to OpenCode as OPENCODE_PERMISSION.
				</p>
			</div>
			<div className="grid gap-3">
				{OPEN_CODE_PERMISSION_COMMON_CONTROLS.map((control, index) => (
					<OpenCodePermissionCommonControl
						control={control}
						disabled={input.disabled}
						index={index}
						key={control.key}
						onChange={(action) => {
							input.onChange(
								updateOpenCodePermissionCommonAction({
									action,
									key: control.key,
									value: input.value,
								})
							);
						}}
						value={resolveOpenCodePermissionCommonAction({
							key: control.key,
							value: input.value,
						})}
					/>
				))}
			</div>
			<details className="grid gap-2">
				<summary className="cursor-pointer text-muted-foreground text-xs">
					Advanced JSON
				</summary>
				<div className="mt-2 grid gap-2">
					<Label htmlFor={advancedId}>OpenCode permission JSON</Label>
					<textarea
						className="min-h-36 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
						disabled={input.disabled}
						id={advancedId}
						onChange={(event) => {
							const nextJson = event.target.value;
							setAdvancedJson(nextJson);
							const parsed = parseOpenCodePermissionJson(nextJson);
							if (!parsed.ok) {
								setAdvancedError(parsed.message);
								return;
							}
							setAdvancedError(null);
							input.onChange(parsed.value);
						}}
						placeholder='{"edit":"ask","bash":{"*":"deny","git status *":"allow"}}'
						spellCheck={false}
						value={advancedJson}
					/>
					{advancedError ? (
						<p className="text-destructive text-xs leading-5">
							{advancedError}
						</p>
					) : (
						<p className="text-muted-foreground text-xs leading-5">
							Leave empty to use OpenCode defaults.
						</p>
					)}
				</div>
			</details>
		</div>
	);
}

function OpenCodePermissionCommonControl(input: {
	control: (typeof OPEN_CODE_PERMISSION_COMMON_CONTROLS)[number];
	disabled: boolean;
	index: number;
	onChange: (action: OpenCodePermissionCommonAction) => void;
	value: OpenCodePermissionCommonAction;
}) {
	const selectId = useId();
	const displayValue = formatOpenCodePermissionActionLabel(input.value);
	return (
		<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] sm:items-center sm:gap-3">
			<div className="min-w-0">
				<Label className="text-sm" htmlFor={selectId}>
					{input.control.label}
				</Label>
				<p className="text-muted-foreground text-xs leading-5">
					{input.control.description}
				</p>
			</div>
			<Select
				disabled={input.disabled}
				onValueChange={(value) => {
					input.onChange(value as OpenCodePermissionCommonAction);
				}}
				value={input.value}
			>
				<SelectTrigger
					aria-label={input.control.label}
					className="h-10 w-full px-3 text-sm"
					displayValue={displayValue}
					id={selectId}
					placeholder="OpenCode default"
				/>
				<SelectContent className="max-h-64">
					{input.value === "custom" ? (
						<SelectItem disabled index={0} value="custom">
							Custom JSON
						</SelectItem>
					) : null}
					{OPEN_CODE_PERMISSION_ACTION_OPTIONS.map((option, optionIndex) => (
						<SelectItem
							index={optionIndex + (input.value === "custom" ? 1 : 0)}
							key={option.value}
							value={option.value}
						>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

export function isOpenCodeAgentControllerRef(
	agentControllerRef: string | null | undefined
): boolean {
	return agentControllerRef === OPEN_CODE_AGENT_CONTROLLER_REF;
}

export function isOpenCodeAgentId(agentId: string | null | undefined): boolean {
	return isOpenCodeAgentControllerRef(agentId ? `builtin:${agentId}` : null);
}

export function formatOpenCodePermissionJson(
	value: OpenCodePermissionFieldValue
): string {
	return value ? JSON.stringify(value, null, 2) : "";
}

export function openCodePermissionEquals(
	left: OpenCodePermissionFieldValue,
	right: OpenCodePermissionFieldValue
): boolean {
	return (
		stableStringifyOpenCodePermission(left) ===
		stableStringifyOpenCodePermission(right)
	);
}

function resolveOpenCodePermissionCommonAction(input: {
	key: string;
	value: OpenCodePermissionFieldValue;
}): OpenCodePermissionCommonAction {
	const current = input.value?.[input.key];
	if (current === "allow" || current === "ask" || current === "deny") {
		return current;
	}
	return current ? "custom" : "default";
}

function updateOpenCodePermissionCommonAction(input: {
	action: OpenCodePermissionCommonAction;
	key: string;
	value: OpenCodePermissionFieldValue;
}): OpenCodePermissionFieldValue {
	const next: AgentProfileBindingOpenCodePermission = {
		...(input.value ?? {}),
	};
	if (input.action === "default") {
		delete next[input.key];
	} else if (input.action !== "custom") {
		next[input.key] = input.action;
	}
	return Object.keys(next).length > 0 ? next : null;
}

function parseOpenCodePermissionJson(
	value: string
):
	| { ok: true; value: OpenCodePermissionFieldValue }
	| { message: string; ok: false } {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return { ok: true, value: null };
	}
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(trimmed);
	} catch {
		return { message: "Enter valid JSON.", ok: false };
	}
	const parsedPermission = openCodePermissionConfigSchema.safeParse(parsedJson);
	if (!parsedPermission.success) {
		return {
			message:
				parsedPermission.error.issues[0]?.message ??
				"Enter a valid OpenCode permission object.",
			ok: false,
		};
	}
	return { ok: true, value: parsedPermission.data };
}

function formatOpenCodePermissionActionLabel(
	value: OpenCodePermissionCommonAction
): string {
	switch (value) {
		case "allow":
			return "Allow without asking";
		case "ask":
			return "Ask before running";
		case "custom":
			return "Custom JSON";
		case "deny":
			return "Deny";
		case "default":
			return "OpenCode default";
		default: {
			const exhaustive: never = value;
			return exhaustive;
		}
	}
}

function stableStringifyOpenCodePermission(
	value: OpenCodePermissionFieldValue
): string {
	return JSON.stringify(sortJsonForStableStringify(value));
}

function sortJsonForStableStringify(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nestedValue]) => [
				key,
				sortJsonForStableStringify(nestedValue),
			])
	);
}
