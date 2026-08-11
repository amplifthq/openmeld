export function OrganizationWakeAccessChoice(input: {
	checked: boolean;
	disabled: boolean;
	onCheckedChange: (checked: boolean) => void;
	organizationName: string;
}) {
	return (
		<label className="flex items-start gap-3 py-1 text-sm">
			<input
				aria-label="Enable Wake access for my Agent Profiles"
				checked={input.checked}
				className="mt-0.5 size-4 shrink-0 accent-foreground"
				disabled={input.disabled}
				onChange={(event) => input.onCheckedChange(event.target.checked)}
				type="checkbox"
			/>
			<span>
				<span className="block font-medium text-foreground">
					Enable Wake access for my Agent Profiles
				</span>
				<span className="mt-1 block text-muted-foreground text-xs leading-5">
					Applies to my current bound Agent Profiles and new bound Agent
					Profiles I create in {input.organizationName}.
				</span>
			</span>
		</label>
	);
}
