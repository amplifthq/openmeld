import type { SignalEnvelope } from "@openmeld/protocol";
import { parseEnvelope } from "@openmeld/protocol";

export function parseStoredSignal(raw: string): SignalEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseEnvelope(parsed);
  } catch {
    return null;
  }
}
