import type { RemoteAgentResultSource } from "@openmeld/schemas";

// Provider owners attach provenance out-of-band; never infer it from provider data
// or accept it from a model. Serialization into a retained snapshot makes it durable.
const resultSources = new WeakMap<object, RemoteAgentResultSource[]>();

export function tagRemoteAgentResultSources<T>(
  value: T,
  sources: RemoteAgentResultSource[]
): T {
  if (value && typeof value === "object") {
    resultSources.set(value, sources);
  }
  return value;
}

export function readRemoteAgentResultSources(
  value: unknown
): RemoteAgentResultSource[] {
  return value && typeof value === "object"
    ? (resultSources.get(value) ?? [])
    : [];
}

export function mergeRemoteAgentResultSources(
  ...sources: RemoteAgentResultSource[][]
): RemoteAgentResultSource[] {
  return [
    ...new Map(
      sources.flat().map((source) => [JSON.stringify(source), source])
    ).values(),
  ];
}
