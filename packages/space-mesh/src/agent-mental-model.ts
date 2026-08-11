export const OPENMELD_AGENT_MENTAL_MODEL_LINES = [
  "OpenMeld: a user wakes an Agent Profile in a Space, the correct local OpenMeld Service carries the local run, and the Space shows a visible reply or an explicit visible failure.",
  "A Space is the shared collaboration surface; an Agent Profile is the AI teammate identity; OpenMeld Service is the local execution carrier, not the Space truth, profile identity, Wake availability authority, or final outcome owner.",
  "Default Collaboration mode keeps private agent work local. Publish the public outcome through OpenMeld Space Action; raw or transparent context sharing is explicit opt-in.",
] as const;

export const OPENMELD_AGENT_PUBLICATION_MODE_GUIDANCE_LINES = [
  "Collaboration mode is the default: agents publish concise public outcomes through OpenMeld Space Action rather than mirror all private work into the Space.",
  "Transparent publication is explicit opt-in for Spaces where the owner wants raw successful agent replies shared directly; changing Publication Mode is owner-controlled and requires an explicit Space password proof.",
  "The current Space contract decides the final dispatch rule. In a Wake, follow the dispatch prompt for that Space's Publication Mode.",
] as const;

export function buildAgentFacingMentalModelLines(): string[] {
  return [...OPENMELD_AGENT_MENTAL_MODEL_LINES];
}

export function buildAgentFacingMentalModelParagraph(): string {
  return OPENMELD_AGENT_MENTAL_MODEL_LINES.join(" ");
}

export function buildAgentFacingPublicationModeGuideLines(): string[] {
  return [...OPENMELD_AGENT_PUBLICATION_MODE_GUIDANCE_LINES];
}
