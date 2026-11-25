// Exact platform errors seen on reads during an instance change. A reset
// caused by a stalled input gate has a different cause and recovery policy.
export function durableObjectReplacementReason(error: unknown) {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return null;
  }
  switch (error.message) {
    case "Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.":
      return "inactive_instance";
    case "Durable Object reset because its code was updated.":
      return "code_updated";
    default:
      return null;
  }
}
