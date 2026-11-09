const labels = {
  starting: "Starting",
  connecting: "Connecting",
  connected: "Connected",
  sign_in: "Sign in to continue",
  sign_in_unavailable: "Saved sign-in can't be used",
  reconnecting_network: "Reconnecting, network problem",
  reconnecting_internal: "Reconnecting, something went wrong",
  stopping: "Stopping",
};

export const title = "What you see while this computer connects";

export const state = (v) => labels[v.phase] ?? v.phase;

const words = {
  BeginConnect: "it tries to connect",
  Heartbeat: "the computer answers",
  NeedSignIn: "sign-in is missing or rejected",
  CredentialsUnusable: "the saved sign-in can't be used",
  NetworkDrops: "the network drops",
  InternalFailure: "something inside the service fails",
  YouQuit: "you quit",
};

const hide = new Set([
  "Sign in to continue>Stopping",
  "Saved sign-in can't be used>Stopping",
  "Reconnecting, network problem>Stopping",
  "Reconnecting, something went wrong>Stopping",
  "Connecting>Stopping",
]);

export const step = (action, from, to) => {
  if (action === "Done" || hide.has(`${state(from)}>${state(to)}`)) {
    return null;
  }
  return words[action] ?? null;
};

export const group = (v) => {
  switch (v.phase) {
    case "connected":
      return "Ready";
    case "connecting":
      return "Connecting";
    case "sign_in":
    case "sign_in_unavailable":
      return "Sign-in";
    case "stopping":
      return "Stopping";
    case "reconnecting_network":
    case "reconnecting_internal":
      return "Trouble";
    default:
      return "Starting";
  }
};

export const colors = {
  Starting: "tan",
  Connecting: "blue",
  Ready: "teal",
  "Sign-in": "orange",
  Trouble: "yellow",
  Stopping: "purple",
};
