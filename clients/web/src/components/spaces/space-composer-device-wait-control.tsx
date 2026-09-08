import {
	DEFAULT_WAKE_DEVICE_WAIT_MS,
	MAX_WAKE_DEVICE_WAIT_MS,
} from "@openmeld/schemas";
import type { WakeDeviceWait } from "@openmeld/schemas/types";
import { Input } from "@openmeld/ui/components/input";
import { useId } from "react";
import type { SpaceComposerAddressingTarget } from "./use-space-mention-authoring";

export function SpaceComposerDeviceWaitControl(input: {
	targets: readonly SpaceComposerAddressingTarget[];
	value: WakeDeviceWait | undefined;
	onChange: (value: WakeDeviceWait | undefined) => void;
	disabled: boolean;
}) {
	const deadlineId = useId();
	const targets = input.targets.filter((target) => target.deviceWaitTarget);
	if (targets.length === 0) {
		return null;
	}
	const selected =
		targets.find(
			(target) => target.profileId === input.value?.targetProfileId
		) ?? targets[0];
	const targetChanged =
		input.value &&
		(input.value.bindingId !== selected.deviceWaitTarget?.bindingId ||
			input.value.openMeldServiceRuntimeId !==
				selected.deviceWaitTarget?.openMeldServiceRuntimeId);
	const chooseTarget = (profileId: string) => {
		const target = targets.find(
			(candidate) => candidate.profileId === profileId
		);
		if (!target?.deviceWaitTarget) {
			return;
		}
		input.onChange({
			...target.deviceWaitTarget,
			targetProfileId: target.profileId,
			deadlineAtMs:
				input.value?.deadlineAtMs ?? Date.now() + DEFAULT_WAKE_DEVICE_WAIT_MS,
		});
	};
	return (
		<div className="flex flex-col gap-2 px-3 pb-2 text-sm">
			<label className="flex items-center gap-2">
				<input
					checked={Boolean(input.value)}
					disabled={input.disabled}
					onChange={(event) =>
						event.target.checked
							? chooseTarget(selected.profileId)
							: input.onChange(undefined)
					}
					type="checkbox"
				/>
				Wait for this agent’s computer if it is offline
			</label>
			{input.value ? (
				<div className="flex flex-col gap-2 rounded-md border p-3">
					{targets.length > 1 ? (
						<label className="flex flex-col gap-1">
							Agent
							<select
								className="rounded-md border bg-background p-2"
								disabled={input.disabled}
								onChange={(event) => chooseTarget(event.target.value)}
								value={selected.profileId}
							>
								{targets.map((target) => (
									<option key={target.profileId} value={target.profileId}>
										{target.profileName}
									</option>
								))}
							</select>
						</label>
					) : null}
					{targetChanged ? (
						<p role="alert">
							This Agent’s connected computer changed. Clear this option and
							choose it again.
						</p>
					) : (
						<p>
							This message will Wake {selected.profileName} on{" "}
							{selected.runtimeDeviceDisplayName ??
								"its currently connected computer"}
							. Work will start only after access is checked again.
						</p>
					)}
					<label className="flex flex-col gap-1" htmlFor={deadlineId}>
						Start by
						<Input
							disabled={input.disabled}
							id={deadlineId}
							max={formatLocalDateTime(Date.now() + MAX_WAKE_DEVICE_WAIT_MS)}
							min={formatLocalDateTime(Date.now())}
							onChange={(event) => {
								const deadlineAtMs = new Date(event.target.value).getTime();
								if (input.value) {
									input.onChange({
										...input.value,
										deadlineAtMs: Number.isFinite(deadlineAtMs)
											? deadlineAtMs
											: 0,
									});
								}
							}}
							required
							type="datetime-local"
							value={formatLocalDateTime(input.value.deadlineAtMs)}
						/>
					</label>
					<p className="text-muted-foreground text-xs">
						You can cancel while it waits. Interrupted work will not restart
						automatically.
					</p>
				</div>
			) : null}
		</div>
	);
}

function formatLocalDateTime(value: number): string {
	if (value === 0) {
		return "";
	}
	const date = new Date(value);
	return new Date(value - date.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 16);
}
