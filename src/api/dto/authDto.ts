import { DashboardSession } from "../types/session";

export function toAuthUserDto(
  session: DashboardSession,
  isGlobalAdmin: boolean
): {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
  isGlobalAdmin: boolean;
} {
  const avatarUrl = session.avatar
    ? `https://cdn.discordapp.com/avatars/${session.userId}/${session.avatar}.png?size=256`
    : null;

  return {
    id: session.userId,
    username: session.username,
    globalName: session.globalName,
    avatarUrl,
    isGlobalAdmin
  };
}
