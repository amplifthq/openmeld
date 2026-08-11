import type { Component } from "@mariozechner/pi-tui";
import type { SessionDocumentBlockViewState } from "../../../view/space-session-view-state";
import { renderSessionHeaderLines } from "./render-session-header-lines";
import { renderSpaceSummaryLines } from "./render-space-summary-lines";
import { TranscriptBlockPanel } from "./transcript-block-panel";

export class SessionDocumentPanel implements Component {
  readonly #transcriptBlockPanel = new TranscriptBlockPanel();
  #blocks: readonly SessionDocumentBlockViewState[] = [];

  setBlocks(blocks: readonly SessionDocumentBlockViewState[]): void {
    this.#blocks = blocks;
    this.#transcriptBlockPanel.invalidate();
  }

  invalidate(): void {
    this.#transcriptBlockPanel.invalidate();
  }

  render(width: number): string[] {
    return buildDocumentLines(this.#blocks, this.#transcriptBlockPanel, width);
  }
}

function buildDocumentLines(
  blocks: readonly SessionDocumentBlockViewState[],
  transcriptBlockPanel: TranscriptBlockPanel,
  width: number
): string[] {
  const lines: string[] = [];
  let previousBlock: SessionDocumentBlockViewState | null = null;

  for (const block of blocks) {
    let blockLines: string[];
    if (block.kind === "session_header") {
      blockLines = renderSessionHeaderLines({
        block,
        width,
      });
    } else if (block.kind === "transcript") {
      blockLines = renderTranscriptBlock(block, transcriptBlockPanel, width);
    } else if (block.kind === "space_summary") {
      blockLines = renderSpaceSummaryLines({
        segments: block.segments,
        tone: "default",
        width,
      });
    } else {
      blockLines = [...block.lines];
    }

    if (blockLines.length === 0) {
      continue;
    }
    if (previousBlock && shouldInsertBlockGap(previousBlock, block)) {
      lines.push("");
    }
    lines.push(...blockLines);
    previousBlock = block;
  }

  return lines;
}

function shouldInsertBlockGap(
  _previousBlock: SessionDocumentBlockViewState,
  _nextBlock: SessionDocumentBlockViewState
): boolean {
  return true;
}

function renderTranscriptBlock(
  block: Extract<SessionDocumentBlockViewState, { kind: "transcript" }>,
  transcriptBlockPanel: TranscriptBlockPanel,
  width: number
): string[] {
  transcriptBlockPanel.setBlocks(block.blocks);
  return transcriptBlockPanel.render(width);
}
