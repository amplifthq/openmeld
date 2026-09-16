import type { IpcMainInvokeEvent, WebContents } from "electron";

/** Native capabilities belong only to the app's own top-level document. */
export function assertTrustedRenderer(
  event: IpcMainInvokeEvent,
  owner: WebContents | null,
  rendererUrl: string
): void {
  const frame = event.senderFrame;
  if (
    !owner ||
    owner.isDestroyed() ||
    event.sender !== owner ||
    !frame ||
    frame !== owner.mainFrame ||
    !isRendererUrl(frame.url, rendererUrl)
  ) {
    throw new Error("Desktop IPC sender is not the application document.");
  }
}

export function isRendererUrl(candidate: string, rendererUrl: string): boolean {
  try {
    const actual = new URL(candidate);
    const expected = new URL(rendererUrl);
    if (actual.username || actual.password) {
      return false;
    }
    // file: origins are all "null"; compare the document, never just origin.
    if (expected.protocol === "file:") {
      return (
        actual.protocol === "file:" && actual.pathname === expected.pathname
      );
    }
    return (
      actual.origin === expected.origin &&
      actual.host === expected.host &&
      actual.protocol === expected.protocol
    );
  } catch {
    return false;
  }
}
