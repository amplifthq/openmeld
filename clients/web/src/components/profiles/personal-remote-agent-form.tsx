"use client";

import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { useId, useRef, useState } from "react";
import { SpinnerButton } from "#/components/spinner-button";
import type { CreateProfileFormProps } from "./create-profile-form";

export function PersonalRemoteAgentForm(input: {
	form: CreateProfileFormProps;
	onChooseLocal: () => void;
	onSubmit: (input: {
		idempotencyKey: string;
		modelId: string | null;
		profileName: string;
	}) => void;
}) {
	const nameId = useId();
	const modelId = useId();
	const [name, setName] = useState("Remote Agent");
	const [model, setModel] = useState("");
	const intent = useRef<{ fingerprint: string; key: string } | null>(null);
	const catalog = input.form.modelCatalog?.agentControllers["center-agent"];
	return (
		<form
			className="grid gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (input.form.isSubmitting || !name.trim() || !catalog) {
					return;
				}
				const fingerprint = JSON.stringify([name.trim(), model]);
				if (intent.current?.fingerprint !== fingerprint) {
					intent.current = { fingerprint, key: crypto.randomUUID() };
				}
				input.onSubmit({
					idempotencyKey: intent.current.key,
					modelId: model || null,
					profileName: name.trim(),
				});
			}}
		>
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-medium text-lg">Create Remote Agent</h2>
				<Button
					disabled={input.form.isSubmitting}
					onClick={input.onChooseLocal}
					type="button"
					variant="ghost"
				>
					Choose a Local Agent
				</Button>
			</div>
			<p className="text-muted-foreground text-sm">
				Runs in the cloud, even when your computer is off. Chat directly or add
				it to a Space.
			</p>
			<div className="grid gap-2">
				<Label htmlFor={nameId}>Agent name</Label>
				<Input
					disabled={input.form.isSubmitting}
					id={nameId}
					maxLength={80}
					onChange={(event) => setName(event.target.value)}
					value={name}
				/>
			</div>
			<div className="grid gap-2">
				<Label htmlFor={modelId}>Model</Label>
				<select
					className="h-9 rounded-md border border-input bg-background px-3 text-sm"
					disabled={input.form.isSubmitting || !catalog}
					id={modelId}
					onChange={(event) => setModel(event.target.value)}
					value={model}
				>
					<option value="">Default model</option>
					{catalog?.models
						.filter((choice) => choice.hostedRuntime && !choice.unavailable)
						.map((choice) => (
							<option key={choice.id} value={choice.id}>
								{choice.displayName}
							</option>
						))}
				</select>
			</div>
			{input.form.errorState ? (
				<p className="text-destructive text-sm" role="alert">
					{input.form.errorState.message}
				</p>
			) : null}
			<div>
				<SpinnerButton
					disabled={!(name.trim() && catalog) || input.form.isSubmitting}
					isLoading={input.form.isSubmitting}
					type="submit"
				>
					Create Agent
				</SpinnerButton>
			</div>
		</form>
	);
}
