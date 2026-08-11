import { SettingsSection } from "@openmeld/ui/components/settings-section";

/**
 * A placeholder leaf for a Settings section whose content lands in a later step
 * of this phase (Computers / Agents / Service). It renders the section frame and
 * an honest "coming in this phase" note so the routed shell, inner nav, and
 * capability gating can be exercised end-to-end before the real panels arrive.
 * Purely presentational — no data, no liveness/availability/Wake semantics.
 */
export function SettingsPlaceholderSection(input: {
	id: string;
	title: string;
	description: string;
}) {
	return (
		<SettingsSection
			description={input.description}
			id={input.id}
			title={input.title}
		>
			<p className="text-muted-foreground text-sm">
				This section is coming in this phase.
			</p>
		</SettingsSection>
	);
}
