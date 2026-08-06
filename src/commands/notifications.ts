import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type ChatInputCommandInteraction
} from 'discord.js';
import { truncate } from '../lib/format.js';
import type { ShopNotification } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const DEFAULT_COUNT = 10;
const MAX_COUNT = 20;
const MAX_DESCRIPTION_LENGTH = 150;
const DASHBOARD_BASE_URL = 'https://dash.sellauth.com';

const LEVEL_MARKERS: Readonly<Record<string, string>> = {
  success: '\uD83D\uDFE2',
  info: '\uD83D\uDD35',
  warning: '\uD83D\uDFE1',
  error: '\uD83D\uDD34'
};

function notificationLine(notification: ShopNotification): string {
  const marker = LEVEL_MARKERS[notification.level] ?? '\u26AA';
  const title =
    notification.link === null || notification.link === ''
      ? `**${notification.title}**`
      : `**[${notification.title}](${DASHBOARD_BASE_URL}${notification.link})**`;
  const when = time(new Date(notification.created_at), TimestampStyles.RelativeTime);
  const description =
    notification.description === null || notification.description === ''
      ? ''
      : `\n${truncate(notification.description, MAX_DESCRIPTION_LENGTH)}`;
  return `${marker} ${title} \u00B7 ${when}${description}`;
}

export const notificationsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('The latest notifications from your shop dashboard')
    .addIntegerOption((option) =>
      option
        .setName('count')
        .setDescription(`How many to show (default ${DEFAULT_COUNT}, max ${MAX_COUNT})`)
        .setMinValue(1)
        .setMaxValue(MAX_COUNT)
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const count = interaction.options.getInteger('count') ?? DEFAULT_COUNT;
    const latest = await context.sellAuth.getLatestNotifications();

    if (latest.notifications.length === 0) {
      await interaction.editReply({ content: 'No notifications yet.' });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('Latest notifications')
      .setDescription(latest.notifications.slice(0, count).map(notificationLine).join('\n\n'))
      .setFooter({ text: `${latest.unread_count} unread` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
