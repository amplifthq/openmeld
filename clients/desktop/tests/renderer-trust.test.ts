import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from "electron";
import { describe, expect, it } from "vitest";
import {
  assertTrustedRenderer,
  isRendererUrl,
} from "../src/main/renderer-trust";

const documentUrl =
  "file:///Applications/OpenMeld.app/Contents/Resources/app/out/renderer/index.html";

describe("native capability sender authorization", () => {
  it("accepts the app document and rejects other windows, frames and documents", () => {
    const frame = { url: documentUrl };
    const owner = { mainFrame: frame, isDestroyed: () => false } as WebContents;
    const event = { sender: owner, senderFrame: frame } as IpcMainInvokeEvent;
    expect(() =>
      assertTrustedRenderer(event, owner, documentUrl)
    ).not.toThrow();

    for (const untrusted of [
      { ...event, sender: {} as WebContents },
      { ...event, senderFrame: { url: documentUrl } as WebFrameMain },
      { ...event, senderFrame: null },
    ]) {
      expect(() =>
        assertTrustedRenderer(untrusted, owner, documentUrl)
      ).toThrow();
    }
    frame.url = "https://openmeld.ai/";
    expect(() => assertTrustedRenderer(event, owner, documentUrl)).toThrow();
    expect(() => assertTrustedRenderer(event, null, documentUrl)).toThrow();
  });

  it("does not trust other files sharing the null origin or another dev server", () => {
    expect(isRendererUrl(`${documentUrl}#settings`, documentUrl)).toBe(true);
    expect(isRendererUrl("file:///tmp/untrusted.html", documentUrl)).toBe(
      false
    );
    expect(
      isRendererUrl("http://localhost:5174/", "http://localhost:5173/")
    ).toBe(false);
    expect(
      isRendererUrl(
        "http://localhost:5173/o/team/spaces",
        "http://localhost:5173/"
      )
    ).toBe(true);
    expect(
      isRendererUrl("http://user@localhost:5173/", "http://localhost:5173/")
    ).toBe(false);
  });
});
