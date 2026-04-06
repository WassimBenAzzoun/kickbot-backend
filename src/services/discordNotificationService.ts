import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  PermissionFlagsBits
} from "discord.js";
import { Logger } from "pino";
import { NormalizedStreamStatus } from "../types/stream";

const EMOJI_FIRE = ":fire:";
const EMOJI_ROCKET = ":rocket:";
const EMOJI_BOLT = ":zap:";
const EMOJI_GAMEPAD = ":video_game:";
const EMOJI_MOVIE = ":movie_camera:";
const EMOJI_ROTATING_LIGHT = ":rotating_light:";
const EMOJI_MEMO = ":memo:";
const EMOJI_GREEN_CIRCLE = ":green_circle:";
const EMOJI_BUST = ":bust_in_silhouette:";
const EMOJI_EYES = ":eyes:";

const LIVE_EMOJIS = [EMOJI_FIRE, EMOJI_ROCKET, EMOJI_BOLT, EMOJI_GAMEPAD];
const EMBED_COLOR_KICK_LIVE = 0x00ff88;
const MAX_TITLE_LENGTH = 180;
const MENTION_EVERYONE = true; // Configurable later.

export class DiscordNotificationService {
  public constructor(
    private readonly client: Client,
    private readonly logger: Logger
  ) {}

  public async sendLiveNotification(
    guildId: string,
    alertChannelId: string,
    status: NormalizedStreamStatus
  ): Promise<string | null> {
    const channel = await this.client.channels.fetch(alertChannelId);

    if (!channel) {
      this.logger.warn({ guildId, alertChannelId }, "Alert channel not found");
      return null;
    }

    if (!channel.isTextBased() || channel.isDMBased()) {
      this.logger.warn(
        { guildId, alertChannelId, channelType: channel.type },
        "Configured alert channel is not a guild text channel"
      );
      return null;
    }

    const clientUser = this.client.user;
    if (!clientUser) {
      this.logger.error({ guildId, alertChannelId }, "Discord client user is not ready");
      return null;
    }

    if ("permissionsFor" in channel) {
      const permissions = channel.permissionsFor(clientUser.id);
      if (
        !permissions ||
        !permissions.has(PermissionFlagsBits.SendMessages) ||
        !permissions.has(PermissionFlagsBits.EmbedLinks)
      ) {
        this.logger.warn(
          { guildId, alertChannelId },
          "Missing permissions to post live notifications"
        );
        return null;
      }
    }

    const randomLiveEmoji = LIVE_EMOJIS[Math.floor(Math.random() * LIVE_EMOJIS.length)] ?? EMOJI_FIRE;
    const displayTitle = this.formatStreamTitle(status.title);
    const footerBotName = this.client.user?.username ?? "Kick Bot";

    const embed = new EmbedBuilder()
      .setTitle(`${status.streamerUsername} is LIVE on Kick ${EMOJI_FIRE}`)
      .setURL(status.streamUrl)
      .setDescription(`${EMOJI_MEMO} ${displayTitle}`)
      .setColor(EMBED_COLOR_KICK_LIVE)
      .addFields(
        {
          name: `${EMOJI_GREEN_CIRCLE} Platform`,
          value: "Kick",
          inline: true
        },
        {
          name: `${EMOJI_GAMEPAD} Category`,
          value: status.category ?? "Unknown",
          inline: true
        },
        {
          name: `${EMOJI_BUST} Streamer`,
          value: status.streamerUsername,
          inline: true
        },
        {
          name: `${EMOJI_EYES} Viewers`,
          value: this.formatViewerCount(status.viewerCount),
          inline: true
        },
        {
          name: `${EMOJI_MEMO} Title`,
          value: displayTitle,
          inline: false
        }
      )
      .setFooter({
        text: `Kick Live Notification - ${footerBotName}`,
        iconURL: clientUser.displayAvatarURL()
      })
      .setTimestamp(new Date());

    if (status.profileImageUrl) {
      embed.setThumbnail(status.profileImageUrl);
    }

    if (status.thumbnailUrl) {
      embed.setImage(status.thumbnailUrl);
    }

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel(`Watch Now`)
        .setStyle(ButtonStyle.Link)
        .setURL(status.streamUrl)
    );

    const mentionPrefix = MENTION_EVERYONE ? "@everyone " : "";
    const content = `${mentionPrefix}${EMOJI_ROTATING_LIGHT} **${status.streamerUsername} just went LIVE!** ${randomLiveEmoji}`.trim();

    const message = await channel.send({
      content,
      embeds: [embed],
      components: [actionRow],
      allowedMentions: {
        parse: MENTION_EVERYONE ? ["everyone"] : []
      }
    });

    return message.id;
  }

  private formatStreamTitle(value: string | null): string {
    if (!value || value.trim().length === 0) {
      return "No stream title available";
    }

    const trimmed = value.trim();
    if (trimmed.length <= MAX_TITLE_LENGTH) {
      return trimmed;
    }

    return `${trimmed.slice(0, MAX_TITLE_LENGTH - 3)}...`;
  }

  private formatViewerCount(value: number | null): string {
    if (value === null || value < 0) {
      return "N/A";
    }

    return new Intl.NumberFormat("en-US").format(value);
  }
}

