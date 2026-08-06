import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type ChatInputCommandInteraction
} from 'discord.js';
import { truncate } from '../lib/format.js';
import type { ActivityLogEntry } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const PAGE_SIZE = 10;
const MAX_CHANGED_KEYS = 3;
const MAX_VALUE_LENGTH = 30;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'object') {
    return '[\u2026]';
  }
  return truncate(String(value), MAX_VALUE_LENGTH);
}

/** Summarizes what changed, e.g. "stock: 26 → 102, price: 5 → 10". */
function changesSummary(entry: ActivityLogEntry): string {
  const attributes = entry.properties?.attributes;
  if (attributes === undefined) {
    return '';
  }
  const old = entry.properties?.old ?? {};
  const parts: string[] = [];
  for (const [key, newValue] of Object.entries(attributes)) {
    if (parts.length >= MAX_CHANGED_KEYS) {
      parts.push('\u2026');
      break;
    }
    const oldValue = old[key];
    parts.push(
      oldValue === undefined
        ? `${key}: ${formatValue(newValue)}`
        : `${key}: ${formatValue(oldValue)} \u2192 ${formatValue(newValue)}`
    );
  }
  return parts.length > 0 ? `\n${parts.join(', ')}` : '';
}

function entryLine(entry: ActivityLogEntry): string {
  const when = time(new Date(entry.created_at), TimestampStyles.RelativeTime);
  const who = entry.user_email ?? 'system';
  const subject =
    entry.subject_type === null ? '' : ` ${entry.subject_type}${entry.subject_id === null ? '' : ` #${entry.subject_id}`}`;
  return `${when} \u00B7 **${who}** ${entry.type}${subject}${changesSummary(entry)}`;
}

export const activityCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('Audit log of dashboard and staff actions')
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Page number (default 1)').setMinValue(1)
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const page = interaction.options.getInteger('page') ?? 1;
    const logs = await context.sellAuth.getActivityLogs(page, PAGE_SIZE);

    if (logs.data.length === 0) {
      await interaction.editReply({
        content: page === 1 ? 'No activity logged yet.' : `Page ${page} is empty (last page is ${logs.last_page}).`
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('Activity log')
      .setDescription(logs.data.map(entryLine).join('\n\n'))
      .setFooter({ text: `Page ${logs.current_page}/${logs.last_page} \u00B7 ${logs.total} entries` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
