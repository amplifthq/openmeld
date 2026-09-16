// Read adapter for the original config.json layout. Current files and current
// controller settings remain authoritative; all values still use today's parser.
export function readLegacyAgentRegistrations(agents: unknown): unknown {
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    return undefined;
  }
  return { controllers: (agents as { registrations?: unknown }).registrations };
}
