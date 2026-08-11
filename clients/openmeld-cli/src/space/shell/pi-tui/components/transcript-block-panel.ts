import { type Component, Text } from "@mariozechner/pi-tui";
import {
  renderTranscriptBlocks,
  type TranscriptBlockViewState,
} from "../../../transcript/transcript-render";

export class TranscriptBlockPanel implements Component {
  readonly #text = new Text("", 0, 0);
  #blocks: readonly TranscriptBlockViewState[] = [];

  setBlocks(blocks: readonly TranscriptBlockViewState[]): void {
    this.#blocks = blocks;
    this.#text.invalidate();
  }

  invalidate(): void {
    this.#text.invalidate();
  }

  render(width: number): string[] {
    this.#text.setText(renderTranscriptBlocks(this.#blocks, width).join("\n"));
    return this.#text.render(width);
  }
}
