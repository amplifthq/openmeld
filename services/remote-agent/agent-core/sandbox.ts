export type RemoteAgentSandboxDecision = "disabled" | "deferred" | "enabled";

export type RemoteAgentSandboxCapabilityRow = {
  capability: string;
  decision: RemoteAgentSandboxDecision;
  evidence: string;
  rationale: string;
  risk: string;
};

export const REMOTE_AGENT_SANDBOX_CAPABILITY_TABLE: readonly RemoteAgentSandboxCapabilityRow[] =
  [
    {
      capability: "Cloudflare Sandbox filesystem and shell tools",
      decision: "enabled",
      rationale:
        "Each Remote Agent submission receives an isolated Cloudflare Sandbox container through Flue's official adapter.",
      risk: "Sandbox commands can access the public network and consume container runtime; every operation emits raw usage evidence.",
      evidence:
        "The Worker declares the Sandbox container and Durable Object binding, and the agent creates a submission-scoped sandbox.",
    },
    {
      capability: "Local sandbox",
      decision: "disabled",
      rationale:
        "Local sandbox would expose host filesystem and shell and is outside the hosted Center Agent trust boundary.",
      risk: "None in this batch because local sandbox is not configured.",
      evidence: "No Flue local sandbox import or configuration exists.",
    },
    {
      capability: "Host filesystem access",
      decision: "disabled",
      rationale:
        "Hosted Center Agent work stays inside Cloudflare Sandbox and never mounts the OpenMeld host or a user's workstation.",
      risk: "None in this phase because no host mount or local process binding is configured.",
      evidence:
        "The agent uses only the Cloudflare Sandbox Durable Object binding.",
    },
  ];
