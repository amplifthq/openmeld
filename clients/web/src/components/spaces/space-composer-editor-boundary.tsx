import { Textarea } from "@openmeld/ui/components/textarea";
import {
	Component,
	type FocusEventHandler,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { reportCaughtComponentError } from "#/lib/observability/application-error-client";
import type { SpaceComposerEditorChange } from "./space-composer-editor";

type Props = {
	ariaLabel: string;
	children: ReactNode;
	maxHeight?: number;
	onBlur?: FocusEventHandler<HTMLTextAreaElement>;
	onChange: (change: SpaceComposerEditorChange) => void;
	onFailure: () => void;
	onFocus?: FocusEventHandler<HTMLTextAreaElement>;
	onSend: () => void;
	placeholder: string;
	text: string;
};

export class SpaceComposerEditorBoundary extends Component<
	Props,
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: Error) {
		reportCaughtComponentError(error, "space_composer_editor");
		this.props.onFailure();
	}

	render() {
		if (!this.state.failed) {
			return this.props.children;
		}

		return (
			<div data-slot="space-composer-editor-fallback">
				<output className="block px-1 text-muted-foreground text-sm">
					The message editor stopped working. You can still send text. Reload to
					edit mentions.
				</output>
				<Textarea
					aria-label={this.props.ariaLabel}
					className="min-h-11 resize-none border-0 bg-transparent px-1 py-2 text-sm leading-6 shadow-none focus-visible:ring-0"
					onBlur={this.props.onBlur}
					onChange={(event) => {
						const text = event.currentTarget.value;
						this.props.onChange({
							authoredMentions: [],
							selection: {
								start: event.currentTarget.selectionStart,
								end: event.currentTarget.selectionEnd,
							},
							text,
						});
					}}
					onFocus={this.props.onFocus}
					onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							this.props.onSend();
						}
					}}
					placeholder={this.props.placeholder}
					style={{ maxHeight: this.props.maxHeight ?? 240 }}
					value={this.props.text}
				/>
			</div>
		);
	}
}
