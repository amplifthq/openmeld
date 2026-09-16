import { DESKTOP_APP_ORIGIN } from "@openmeld/schemas";
import type { Session, WebContents } from "electron";
import { createPilotProtocol } from "./pilot-protocol";
import { isRendererUrl } from "./renderer-trust";

const ownedSessions = new WeakSet<Session>();

/** Owns the sole before-request listener and protocol on a private pilot Session. */
export function installPilotTransport(
  session: Session,
  getOwner: () => WebContents | null,
  options: Parameters<typeof createPilotProtocol>[0]
): () => void {
  if (ownedSessions.has(session)) {
    throw new Error("Desktop transport already owns this Session");
  }
  ownedSessions.add(session);
  let disposed = false;
  session.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      let cancel = true;
      try {
        const url = new URL(details.url);
        const protectedRequest =
          url.protocol === "openmeld-desktop:" &&
          (url.pathname.startsWith("/v1/") ||
            url.pathname.startsWith("/_serverFn/"));
        if (protectedRequest) {
          const owner = getOwner();
          const frame = details.frame;
          cancel =
            disposed ||
            !owner ||
            owner.isDestroyed() ||
            details.webContentsId !== owner.id ||
            !frame ||
            frame !== owner.mainFrame ||
            details.resourceType === "mainFrame" ||
            details.resourceType === "subFrame" ||
            !isRendererUrl(frame.url, DESKTOP_APP_ORIGIN);
        } else {
          cancel = false;
        }
      } catch {
        // Destroyed frames and missing provenance never grant transport access.
      }
      callback({ cancel });
    }
  );
  try {
    session.protocol.handle("openmeld-desktop", createPilotProtocol(options));
  } catch (error) {
    session.webRequest.onBeforeRequest(null);
    throw error;
  }
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    // Remove the credential-bearing handler before removing its admission gate.
    session.protocol.unhandle("openmeld-desktop");
    session.webRequest.onBeforeRequest(null);
  };
}
