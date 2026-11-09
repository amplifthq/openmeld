const labels = {
  nothing: "Nothing shown yet",
  sending: "Sending",
  waiting: "Waiting to reach the agent",
  working: "The agent is working",
  couldnt_confirm: "Couldn't confirm the reply",
  couldnt_reply: "Couldn't reply",
  stopped: "You stopped it",
  replied: "The agent replied",
};

export const title = "What you see after you ask an agent to work";

export const state = (v) => {
  if (v.sawStop && v.banner === "couldnt_reply") {
    return "Couldn't reply, after you stopped";
  }
  if (v.sawStop && v.banner === "couldnt_confirm") {
    return "Couldn't confirm the reply, after you stopped";
  }
  if (v.sawStop && v.banner === "replied") {
    return "A reply arrived after you stopped";
  }
  return labels[v.banner] ?? v.banner;
};

const keep = new Set([
  "Nothing shown yet>Sending",
  "Nothing shown yet>You stopped it",
  "Sending>Waiting to reach the agent",
  "Waiting to reach the agent>The agent is working",
  "Waiting to reach the agent>Couldn't reply",
  "Waiting to reach the agent>You stopped it",
  "The agent is working>Waiting to reach the agent",
  "The agent is working>Couldn't confirm the reply",
  "The agent is working>Couldn't reply",
  "The agent is working>You stopped it",
  "The agent is working>The agent replied",
  "Couldn't reply>The agent replied",
  "Couldn't confirm the reply>The agent replied",
  "You stopped it>Couldn't reply, after you stopped",
  "You stopped it>Couldn't confirm the reply, after you stopped",
  "You stopped it>A reply arrived after you stopped",
]);

export const step = (action, from, to) => {
  const words = {
    YouSend: "you send the message",
    ShowWaiting: "OpenMeld is reaching the agent",
    ShowWorking: "the agent starts working",
    Retry: "OpenMeld tries again",
    CouldntConfirm: "OpenMeld can't confirm the reply",
    CouldntReply: "the wake fails",
    YouStop: "you stop the wake",
    ReplyArrives: "the agent replies",
  };
  if (!keep.has(`${state(from)}>${state(to)}`)) {
    return null;
  }
  return words[action] ?? null;
};

export const group = (v) => {
  const label = state(v);
  if (
    label === "The agent replied" ||
    label === "A reply arrived after you stopped"
  ) {
    return "Reply";
  }
  if (label.startsWith("You stopped") || label.includes("after you stopped")) {
    return "Stopped";
  }
  if (label.startsWith("Couldn't")) {
    return "Closed";
  }
  if (label === "The agent is working") {
    return "Working";
  }
  return "Opening";
};

export const colors = {
  Opening: "blue",
  Working: "teal",
  Closed: "orange",
  Stopped: "purple",
  Reply: "yellow",
};
