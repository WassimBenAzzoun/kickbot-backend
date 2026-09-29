import { Injectable } from "@nestjs/common";
import { ActivityType, Client, EmbedBuilder } from "discord.js";
import { BotActivityType } from "../../generated/prisma/enums.js";
import type { StreamStatus } from "../../kick/kick/kick.service.js";

@Injectable()
export class DiscordService {
  private gatewayReady = false;

  public constructor(private readonly client: Client) {}

  public setReady(value: boolean): void {
    this.gatewayReady = value;
  }

  public isReady(): boolean {
    return this.gatewayReady && this.client.isReady();
  }

  public async sendLiveNotification(
    guildId: string,
    channelId: string,
    status: StreamStatus
  ): Promise<string> {
    const guild = await this.client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isSendable()) throw new Error("Configured alert channel cannot receive messages");
    const embed = new EmbedBuilder()
      .setColor(0x00ff88)
      .setAuthor({
        name: `${status.username} is live on Kick`,
        ...(status.profileImageUrl ? { iconURL: status.profileImageUrl } : {})
      })
      .setTitle(status.title ?? `${status.username} is live`)
      .setURL(status.streamUrl)
      .setTimestamp(status.startedAt ?? new Date());
    if (status.category)
      embed.addFields({ name: "Category", value: status.category, inline: true });
    if (status.viewerCount !== null)
      embed.addFields({
        name: "Viewers",
        value: status.viewerCount.toLocaleString(),
        inline: true
      });
    if (status.thumbnailUrl) embed.setImage(status.thumbnailUrl);
    const message = await channel.send({ embeds: [embed] });
    return message.id;
  }

  public setPresence(text: string | null, activityType: BotActivityType | null): void {
    if (!this.client.user) return;
    if (!text || !activityType) {
      this.client.user.setPresence({ activities: [], status: "online" });
      return;
    }
    const typeByName: Record<BotActivityType, ActivityType> = {
      PLAYING: ActivityType.Playing,
      WATCHING: ActivityType.Watching,
      LISTENING: ActivityType.Listening,
      COMPETING: ActivityType.Competing,
      CUSTOM: ActivityType.Custom
    };
    this.client.user.setPresence({
      activities: [{ name: text, type: typeByName[activityType] }],
      status: "online"
    });
  }
}
