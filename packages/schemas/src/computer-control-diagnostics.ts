// Core generates a fresh UUID for each control. Only project that ID and a
// known frame code: requests and results can contain local paths or settings.
const controlRequestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function computerControlLogFields(frame: {
  code: string;
  payload: Record<string, unknown>;
}) {
  switch (frame.code) {
    case "daemon.computer_power.request":
    case "daemon.computer_power.request_result":
    case "daemon.local_agent_control.refresh_catalog":
    case "daemon.local_agent_control.manage_installation":
      break;
    case "daemon.local_agent_control.result": {
      const result = frame.payload.payload;
      if (
        !result ||
        typeof result !== "object" ||
        !(
          "installations" in result ||
          "syncStatus" in result ||
          "setup" in result ||
          "update" in result
        )
      ) {
        return null;
      }
      break;
    }
    default:
      return null;
  }
  const id = frame.payload.requestId;
  return typeof id === "string" && controlRequestIdPattern.test(id)
    ? { controlRequestId: id, frameCode: frame.code }
    : null;
}
