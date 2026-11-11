const progress = {
  hidden: "No progress shown",
  waiting: "Waiting",
  working: "Working",
};
const outcomes = {
  reply: "Reply published",
  stop: "Stop published",
  failure: "Failure published",
};

export const title = "Space progress after a published outcome";
export const state = (v) => {
  const outcome = outcomes[v.publication];
  if (outcome && v.row !== "hidden") {
    return `${outcome} with late progress: ${progress[v.row]}`;
  }
  return outcome ?? progress[v.row];
};
export const step = (action, from, to) => {
  if (state(from) === state(to)) {
    return null;
  }
  return action === "ObservePublication"
    ? "Space publishes the outcome"
    : "progress arrives";
};
export const group = (v) =>
  v.publication === "none" ? "Progress" : "Published outcome";
export const colors = { Progress: "teal", "Published outcome": "blue" };
