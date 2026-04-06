export interface DashboardSession {
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: number;
}