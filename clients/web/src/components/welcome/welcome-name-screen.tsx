import {
	ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
	accountDisplayNameSchema,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import type { FormEvent } from "react";
import { useState } from "react";
import { WelcomeLayout } from "./welcome-layout";

const NAME_INPUT_ID = "welcome-name-input";

export type WelcomeNameScreenProps = {
	defaultName: string;
	onSubmit: (name: string) => void;
	isPending: boolean;
};

export function WelcomeNameScreen(props: WelcomeNameScreenProps) {
	const [name, setName] = useState(props.defaultName);
	const parsedName = accountDisplayNameSchema.safeParse(name);
	const canContinue = parsedName.success && !props.isPending;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canContinue) {
			return;
		}
		if (parsedName.success) {
			props.onSubmit(parsedName.data);
		}
	};

	return (
		<WelcomeLayout
			subtitle="Shown next to your messages"
			title="What should people call you?"
		>
			<form className="grid max-w-md gap-4" onSubmit={handleSubmit}>
				<div className="grid gap-2">
					<Label className="sr-only" htmlFor={NAME_INPUT_ID}>
						Your name
					</Label>
					<Input
						autoComplete="name"
						disabled={props.isPending}
						id={NAME_INPUT_ID}
						maxLength={ACCOUNT_DISPLAY_NAME_MAX_LENGTH}
						onChange={(event) => setName(event.target.value)}
						placeholder="Your name"
						type="text"
						value={name}
					/>
				</div>
				<Button
					className="w-full"
					disabled={!canContinue}
					size="lg"
					type="submit"
				>
					Continue
				</Button>
			</form>
		</WelcomeLayout>
	);
}
