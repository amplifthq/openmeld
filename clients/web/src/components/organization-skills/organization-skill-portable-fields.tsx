"use client";

import type { OrganizationSkillBundle } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { type SetStateAction, useId, useRef, useState } from "react";

export function OrganizationSkillPortableFields(input: {
	bundle: OrganizationSkillBundle;
	disabled: boolean;
	onChange: (update: SetStateAction<OrganizationSkillBundle>) => void;
	readOnly?: boolean;
}) {
	const portable = input.bundle.portable;
	const updatePortable = (
		update: Partial<OrganizationSkillBundle["portable"]>
	) =>
		input.onChange((current) => ({
			...current,
			portable: { ...current.portable, ...update },
		}));

	if (input.readOnly) {
		return (
			<dl className="grid gap-4 text-sm">
				{[
					["License", portable.license],
					["Compatibility", portable.compatibility],
					["Allowed tools", portable.allowedTools],
				].map(([label, value]) => (
					<div className="grid gap-1" key={label}>
						<dt className="text-muted-foreground">{label}</dt>
						<dd className="break-words">{value || "Not specified"}</dd>
					</div>
				))}
				<div className="grid gap-2">
					<dt className="text-muted-foreground">Metadata</dt>
					<dd>
						<dl className="grid gap-2">
							{Object.entries(portable.metadata).map(([key, value]) => (
								<div key={key}>
									<dt className="text-muted-foreground">{key}</dt>
									<dd className="break-words">{value}</dd>
								</div>
							))}
						</dl>
						{Object.keys(portable.metadata).length === 0 &&
							"No portable metadata."}
					</dd>
				</div>
				<div>
					<dt className="sr-only">Permission boundary</dt>
					<dd className="text-muted-foreground">
						Allowed tools is portable metadata, not permission to use tools.
					</dd>
				</div>
			</dl>
		);
	}

	return (
		<div className="grid gap-5 sm:grid-cols-2">
			<OptionalPortableField
				disabled={input.disabled}
				id="skill-license"
				label="License"
				onChange={(license) => updatePortable({ license })}
				value={portable.license}
			/>
			<OptionalPortableField
				disabled={input.disabled}
				id="skill-compatibility"
				label="Compatibility"
				onChange={(compatibility) => updatePortable({ compatibility })}
				value={portable.compatibility}
			/>
			<div className="grid gap-2 sm:col-span-2">
				<Label htmlFor="skill-allowed-tools">Allowed tools</Label>
				<Input
					disabled={input.disabled}
					id="skill-allowed-tools"
					maxLength={2048}
					onChange={(event) =>
						updatePortable({ allowedTools: event.target.value || null })
					}
					value={portable.allowedTools ?? ""}
				/>
				<p className="text-muted-foreground text-xs">
					Preserved for portability. This field never grants OpenMeld
					permissions.
				</p>
			</div>
			<MetadataFields
				disabled={input.disabled}
				metadata={portable.metadata}
				onChange={(update) =>
					input.onChange((current) => ({
						...current,
						portable: {
							...current.portable,
							metadata:
								typeof update === "function"
									? update(current.portable.metadata)
									: update,
						},
					}))
				}
			/>
		</div>
	);
}

function OptionalPortableField(input: {
	disabled: boolean;
	id: string;
	label: string;
	onChange: (value: string | null) => void;
	value: string | null;
}) {
	return (
		<div className="grid gap-2">
			<Label htmlFor={input.id}>{input.label}</Label>
			<Input
				disabled={input.disabled}
				id={input.id}
				onChange={(event) => input.onChange(event.target.value || null)}
				value={input.value ?? ""}
			/>
		</div>
	);
}

function MetadataFields(input: {
	disabled: boolean;
	metadata: Record<string, string>;
	onChange: (update: SetStateAction<Record<string, string>>) => void;
}) {
	const entries = Object.entries(input.metadata);
	const prefix = useId();
	const ids = useRef(new Map<string, string>());
	const sequence = useRef(0);
	const [error, setError] = useState<string | null>(null);
	const rowId = (key: string) => {
		const known = ids.current.get(key);
		if (known) {
			return known;
		}
		const id = `${prefix}-${++sequence.current}`;
		ids.current.set(key, id);
		return id;
	};
	return (
		<div className="grid gap-3 sm:col-span-2">
			<div className="flex items-center justify-between gap-3">
				<Label>Metadata</Label>
				<Button
					disabled={input.disabled}
					onClick={() => {
						let index = entries.length + 1;
						let key = `key-${index}`;
						while (key in input.metadata) {
							index += 1;
							key = `key-${index}`;
						}
						input.onChange((current) => ({ ...current, [key]: "" }));
					}}
					size="sm"
					variant="outline"
				>
					<PlusIcon aria-hidden="true" /> Add metadata
				</Button>
			</div>
			{error && (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			)}
			{entries.length === 0 ? (
				<p className="text-muted-foreground text-xs">No portable metadata.</p>
			) : (
				<div className="grid gap-2">
					{entries.map(([key, value]) => (
						<div
							className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
							key={rowId(key)}
						>
							<Input
								aria-label={`Metadata key ${key}`}
								disabled={input.disabled}
								onChange={(event) => {
									const nextKey = event.target.value;
									if (
										nextKey !== key &&
										Object.hasOwn(input.metadata, nextKey)
									) {
										setError("A metadata field with that name already exists.");
										return;
									}
									setError(null);
									ids.current.set(nextKey, rowId(key));
									if (key !== nextKey) {
										ids.current.delete(key);
									}
									input.onChange((current) =>
										Object.fromEntries(
											Object.entries(current).map(([name, entry]) => [
												name === key ? nextKey : name,
												entry,
											])
										)
									);
								}}
								value={key}
							/>
							<Input
								aria-label={`Metadata value ${key}`}
								disabled={input.disabled}
								onChange={(event) =>
									input.onChange((current) => ({
										...current,
										[key]: event.target.value,
									}))
								}
								value={value}
							/>
							<Button
								aria-label={`Remove metadata ${key}`}
								disabled={input.disabled}
								onClick={() => {
									input.onChange((current) => {
										const next = { ...current };
										delete next[key];
										return next;
									});
									ids.current.delete(key);
									setError(null);
								}}
								size="icon"
								variant="ghost"
							>
								<XIcon aria-hidden="true" />
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
