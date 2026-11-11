export const title = "What you see when the computer goes quiet during a wake";

export const state = (v) => {
  if (v.phase === "waiting") {
    return "Waiting for the computer";
  }
  if (v.phase === "replied") {
    return "Replied";
  }
  if (v.phase === "stopped") {
    return "You stopped it";
  }
  if (v.phase === "failed") {
    return v.recovery ? "Couldn't finish, computer away" : "Couldn't finish";
  }
  if (v.asking) {
    return "The agent is asking you";
  }
  if (v.quiet === 0 && v.recovery) {
    return "Working, the computer just disconnected";
  }
  if (v.quiet === 0) {
    return "Working";
  }
  if (v.recovery && v.quiet < 6) {
    return "Still working while the computer is away";
  }
  if (v.recovery) {
    return "The computer has been away long enough to stop";
  }
  return "No progress for five minutes";
};

const words = {
  Accept: "the computer picks up the wake",
  ReportProgress: "the agent reports progress",
  TimePasses: "time passes with no progress",
  ComputerDrops: "the computer disconnects",
  Watchdog: "OpenMeld gives up on the quiet computer",
  YouStop: "you stop the wake",
  Reply: "the agent replies",
  AgentAsks: "the agent asks you something",
  YouAnswer: "you answer",
};

const hiddenEdges = new Set([
  "Still working while the computer is away>You stopped it",
  "Working, the computer just disconnected>You stopped it",
  "The computer has been away long enough to stop>You stopped it",
  "No progress for five minutes>Replied",
  "Still working while the computer is away>Replied",
  "Working, the computer just disconnected>Replied",
  "The computer has been away long enough to stop>Replied",
  "The agent is asking you>Replied",
  "Still working while the computer is away>The agent is asking you",
  "Working, the computer just disconnected>The agent is asking you",
  "The computer has been away long enough to stop>The agent is asking you",
]);

export const step = (action, from, to) => {
  const fromLabel = state(from);
  const toLabel = state(to);
  if (action === "Done" || fromLabel === toLabel) {
    return null;
  }
  if (hiddenEdges.has(`${fromLabel}>${toLabel}`)) {
    return null;
  }
  return words[action] ?? null;
};

export const group = (v) => {
  const label = state(v);
  if (label === "Replied") {
    return "Reply";
  }
  if (label === "You stopped it") {
    return "Stopped";
  }
  if (label.startsWith("Couldn't finish")) {
    return "Failed";
  }
  if (label === "The agent is asking you") {
    return "Needs you";
  }
  if (label === "Waiting for the computer") {
    return "Waiting";
  }
  if (label === "Working") {
    return "Working";
  }
  return "Quiet";
};

export const colors = {
  Waiting: "blue",
  Working: "teal",
  "Needs you": "purple",
  Quiet: "orange",
  Reply: "yellow",
  Stopped: "tan",
  Failed: "pink",
};
