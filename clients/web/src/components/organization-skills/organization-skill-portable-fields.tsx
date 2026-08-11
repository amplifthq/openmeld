"use client";

import type { OrganizationSkillBundle } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Textarea } from "@openmeld/ui/components/textarea";
import { PlusIcon, XIcon } from "@phosphor-icons/react";

export function OrganizationSkillPortableFields(input: {
	bundle: OrganizationSkillBundle;
	disabled: boolean;
	onChange: (bundle: OrganizationSkillBundle) => void;
}) {
	const portable = input.bundle.portable;
	const updatePortable = (
		update: Partial<OrganizationSkillBundle["portable"]>
	) =>
		input.onChange({ ...input.bundle, portable: { ...portable, ...update } });

	return (
		<div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
			<div className="grid gap-2">
				<Label htmlFor="skill-name">Name</Label>
				<Input
					disabled={input.disabled}
					id="skill-name"
					maxLength={64}
					onChange={(event) => updatePortable({ name: event.target.value })}
					value={portable.name}
				/>
			</div>
			<div className="grid gap-2 sm:col-span-2">
				<Label htmlFor="skill-description">Description</Label>
				<Textarea
					disabled={input.disabled}
					id="skill-description"
					maxLength={1024}
					onChange={(event) =>
						updatePortable({ description: event.target.value })
					}
					rows={3}
					value={portable.description}
				/>
			</div>
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
				onChange={(metadata) => updatePortable({ metadata })}
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
	onChange: (metadata: Record<string, string>) => void;
}) {
	const entries = Object.entries(input.metadata);
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
						input.onChange({ ...input.metadata, [key]: "" });
					}}
					size="sm"
					variant="outline"
				>
					<PlusIcon aria-hidden="true" /> Add metadata
				</Button>
			</div>
			{entries.length === 0 ? (
				<p className="text-muted-foreground text-xs">No portable metadata.</p>
			) : (
				<div className="grid gap-2">
					{entries.map(([key, value]) => (
						<div className="grid grid-cols-[1fr_1fr_auto] gap-2" key={key}>
							<Input
								aria-label={`Metadata key ${key}`}
								disabled={input.disabled}
								onChange={(event) => {
									const nextKey = event.target.value;
									const next = { ...input.metadata };
									delete next[key];
									next[nextKey] = value;
									input.onChange(next);
								}}
								value={key}
							/>
							<Input
								aria-label={`Metadata value ${key}`}
								disabled={input.disabled}
								onChange={(event) =>
									input.onChange({
										...input.metadata,
										[key]: event.target.value,
									})
								}
								value={value}
							/>
							<Button
								aria-label={`Remove metadata ${key}`}
								disabled={input.disabled}
								onClick={() => {
									const next = { ...input.metadata };
									delete next[key];
									input.onChange(next);
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
