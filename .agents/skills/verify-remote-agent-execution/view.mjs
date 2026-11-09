export const title = "What you see when you stop a hosted agent";

export const state = (v) => {
  if (v.status === "absent" && v.stopWon) {
    return "Stopped before it started";
  }
  switch (v.status) {
    case "absent":
      return "Not started";
    case "pending":
      return "Waiting to start";
    case "running":
      return "Working";
    case "cancellation_requested":
      return "Stopping";
    case "completed":
      return "Replied";
    case "failed":
      return "Couldn't finish";
    case "aborted":
      return "Stopped";
    default:
      return v.status;
  }
};

const words = {
  YouStopFirst: "you stop before it starts",
  Admit: "the agent is admitted",
  Progress: "it starts working",
  YouStop: "you stop",
  CompleteSuccess: "it replies",
  CompleteFail: "it can't finish",
  SettleStop: "the stop finishes",
};

export const step = (action) => {
  if (action === "Done") {
    return null;
  }
  return words[action] ?? null;
};

export const group = (v) => {
  const label = state(v);
  if (label === "Replied") {
    return "Reply";
  }
  if (label === "Couldn't finish") {
    return "Failed";
  }
  if (label === "Working" || label === "Waiting to start") {
    return "Working";
  }
  if (label === "Not started") {
    return "Before";
  }
  return "Stopped";
};

export const colors = {
  Before: "tan",
  Working: "teal",
  Reply: "yellow",
  Failed: "pink",
  Stopped: "purple",
};
