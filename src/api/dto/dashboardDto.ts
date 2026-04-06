export interface DashboardGuildDto {
  guildId: string;
  guildName: string;
  iconUrl: string | null;
  userCanManage: boolean;
  botInGuild: boolean | null;
  configuredAlertChannelId: string | null;
  trackedStreamerCount: number;
}