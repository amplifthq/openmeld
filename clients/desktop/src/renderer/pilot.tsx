import type { DesktopSession } from "@openmeld/schemas";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopPilotBridge } from "../shared/pilot-bridge";
import "./styles.css";

const bridge: DesktopPilotBridge = window.openmeldDesktop;

function Pilot() {
  const [session, setSession] = useState<DesktopSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    async function refresh() {
      try {
        setSession(await bridge.session());
        setError(null);
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not read sign-in status."
        );
      }
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return (
    <main className="mx-auto max-w-lg space-y-4 p-12">
      <h1 className="font-semibold text-xl">OpenMeld Desktop</h1>
      <p>
        {session?.user
          ? `Signed in as ${session.user.email}`
          : "Sign in to open your workspace."}
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        onClick={() => {
          bridge.signIn().catch((failure: Error) => setError(failure.message));
        }}
        type="button"
      >
        Sign in with browser
      </button>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) {
  throw new Error("Desktop page root is missing.");
}
createRoot(root).render(<Pilot />);
