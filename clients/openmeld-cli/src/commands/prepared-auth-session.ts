export type PreparedAuthSession = {
  accessToken: string;
  tokenType: string;
  authBaseUrl: string;
  clientId: string;
  expiresAt?: string;
  scope?: string;
  user: {
    id: string;
    email?: string;
    name?: string;
  };
};
