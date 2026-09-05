"use client";

import type { StructuredApiClientFailure } from "@openmeld/api-client";
import type {
	LocalFolderPickerPurpose,
	LocalFolderPickerResult,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { FolderOpenIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { selectLocalFolders } from "#/lib/connect/local-folder-picker";

const LOCAL_FOLDER_PICKER_WEB_TIMEOUT_MS = 610_000;

type PickerState = {
	deviceId: string;
	isPending: boolean;
	resultError: string | null;
};

export function LocalFolderPickerButton(input: {
	allowMultiple: boolean;
	className?: string;
	deviceId: string;
	disabled?: boolean;
	label: string;
	onSelect: (paths: readonly string[]) => void;
	purpose: LocalFolderPickerPurpose;
	variant?: "default" | "ghost" | "outline";
}) {
	const [state, setState] = useState<PickerState>({
		deviceId: input.deviceId,
		isPending: false,
		resultError: null,
	});
	const currentDeviceIdRef = useRef(input.deviceId);
	useEffect(() => {
		currentDeviceIdRef.current = input.deviceId;
	}, [input.deviceId]);
	const currentState =
		state.deviceId === input.deviceId
			? state
			: {
					deviceId: input.deviceId,
					isPending: false,
					resultError: null,
				};

	const chooseFolders = async () => {
		const deviceId = input.deviceId;
		setState({ deviceId, isPending: true, resultError: null });
		try {
			const result = await selectLocalFolders({
				allowMultiple: input.allowMultiple,
				expectedDeviceId: deviceId,
				purpose: input.purpose,
				timeoutMs: LOCAL_FOLDER_PICKER_WEB_TIMEOUT_MS,
			});
			if (result.status === "selected") {
				if (currentDeviceIdRef.current === deviceId) {
					input.onSelect(result.paths);
				}
				return;
			}
			if (result.status === "cancelled") {
				return;
			}
			setState((current) =>
				current.deviceId === deviceId
					? { ...current, resultError: formatUnavailableResult(result) }
					: current
			);
		} catch (error) {
			setState((current) =>
				current.deviceId === deviceId
					? {
							...current,
							resultError: formatRequestFailure(
								error as StructuredApiClientFailure
							),
						}
					: current
			);
		} finally {
			setState((current) =>
				current.deviceId === deviceId
					? { ...current, isPending: false }
					: current
			);
		}
	};

	return (
		<div className={cn("grid gap-1.5", input.className)}>
			<Button
				disabled={input.disabled || currentState.isPending}
				onClick={() => {
					chooseFolders().catch(() => undefined);
				}}
				size="sm"
				type="button"
				variant={input.variant ?? "outline"}
			>
				<FolderOpenIcon aria-hidden="true" data-icon="inline-start" />
				{currentState.isPending ? "Opening folder picker…" : input.label}
			</Button>
			{currentState.resultError ? (
				<p className="max-w-sm text-destructive text-xs/relaxed" role="alert">
					{currentState.resultError}
				</p>
			) : null}
		</div>
	);
}

function formatUnavailableResult(
	result: Extract<LocalFolderPickerResult, { status: "unavailable" }>
): string {
	switch (result.code) {
		case "local.folder_picker.no_interactive_session":
			return "Sign in to this computer, then try again.";
		case "local.folder_picker.picker_busy":
			return "Finish or close the folder picker already open on this computer.";
		case "local.folder_picker.service_offline":
			return "This computer is offline.";
		case "local.folder_picker.service_update_required":
		case "local.folder_picker.helper_missing":
			return "Update or reconnect this computer, then try again.";
		case "local.folder_picker.portal_unavailable":
			return "A desktop folder picker isn’t available in this Linux session.";
		case "local.folder_picker.timed_out":
			return "The folder picker was open too long. Try again.";
		default:
			return "OpenMeld couldn’t open the folder picker. Enter the path manually instead.";
	}
}

function formatRequestFailure(error: StructuredApiClientFailure): string {
	if (error.upstreamCode === "local.folder_picker.service_offline") {
		return "This computer is offline.";
	}
	return (
		error.message || "OpenMeld couldn’t open the folder picker. Try again."
	);
}
