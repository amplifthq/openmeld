import { Button } from "@openmeld/ui/components/button";
import { Component, type ReactNode } from "react";
import { reportClientApplicationError } from "#/lib/observability/application-error-client";

export class SpaceLandingErrorBoundary extends Component<
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
				aria-label="Conversation error"
				className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
				data-slot="space-landing-error"
			>
				<h1 className="font-medium text-lg">
					This conversation stopped working.
				</h1>
				<p className="text-muted-foreground text-sm">
					Try again, or open another conversation from the sidebar.
				</p>
				<Button
					onClick={() => this.setState({ failed: false })}
					type="button"
					variant="secondary"
				>
					Try again
				</Button>
			</section>
		);
	}
}
