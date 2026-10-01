import { Component, type ReactNode } from "react";
import { reportClientApplicationError } from "#/lib/observability/application-error-client";

// Recovery can be deferred by unsaved work or an in-flight send elsewhere in
// the workspace. A rejected lazy section must not unmount those owners.
export class SettingsContentErrorBoundary extends Component<
	{ children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: Error) {
		reportClientApplicationError(error, "react_caught");
	}

	render() {
		if (!this.state.failed) {
			return this.props.children;
		}
		return (
			<section
				aria-label="Settings error"
				className="grid gap-2 p-6"
				role="alert"
			>
				<h2 className="font-medium">Settings couldn’t load.</h2>
				<p className="text-muted-foreground text-sm">
					Return to your work and save or finish any changes. Then refresh the
					page to try again.
				</p>
			</section>
		);
	}
}
