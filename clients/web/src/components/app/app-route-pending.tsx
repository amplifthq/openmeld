import { OpenMeldLoadingScreen } from "@openmeld/ui/components/openmeld-loading-screen";

export function AppRoutePending() {
	return (
		<OpenMeldLoadingScreen>
			<output>Opening OpenMeld…</output>
		</OpenMeldLoadingScreen>
	);
}
