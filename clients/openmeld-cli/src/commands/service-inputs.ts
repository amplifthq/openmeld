export type DaemonBaseInput = {
  agentOverviewHandled?: boolean;
  gatewayUrl?: string;
  json?: boolean;
  profile?: string;
  view?: string;
};

export type DaemonControlInput = DaemonBaseInput & {
  dispatch?: string;
  reason?: string;
  task?: string;
};
