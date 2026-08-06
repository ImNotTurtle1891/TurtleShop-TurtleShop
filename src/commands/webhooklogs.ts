import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatCount, truncate } from '../lib/format.js';
import type { WebhookLogEntry } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const PAGE_SIZE = 8;
const MAX_ERROR_PREVIEW = 120;

/** Webhook URLs often carry API keys in the query string — show origin + path only. */
function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl;
  }
}

function logLine(entry: WebhookLogEntry): string {
  const marker = entry.success ? '\u2705' : '\u274C';
  const status = entry.response_status === null ? 'no response' : `HTTP ${entry.response_status}`;
  const duration = entry.duration_ms === null ? '' : ` \u00B7 ${formatCount(entry.duration_ms)}ms`;
  const parts = [
    `${marker} **${entry.event}** (${entry.source})`,
    `${status}${duration} \u00B7 ${time(new Date(entry.created_at), TimestampStyles.ShortDateTime)}`,
    redactUrl(entry.url)
  ];
  if (entry.invoice_id !== null) {
    parts.push(`invoice \`${entry.invoice_id}\``);
  }
  if (!entry.success && entry.error_message !== null && entry.error_message !== '') {
    parts.push(truncate(entry.error_message.replace(/\s+/g, ' ').trim(), MAX_ERROR_PREVIEW));
  }
  return parts.join('\n');
}

export const webhookLogsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('webhooklogs')
    .setDescription('Outgoing webhook and dynamic-delivery request logs, for debugging')
    .addBooleanOption((option) =>
      option.setName('failed').setDescription('Only failed deliveries')
    )
    .addStringOption((option) =>
      option
        .setName('source')
        .setDescription('Only this kind of request')
        .addChoices(
          { name: 'Notification webhooks', value: 'notification' },
          { name: 'Dynamic delivery', value: 'dynamic_delivery' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('invoice')
        .setDescription('Only requests for this invoice (numeric or unique ID)')
        .setMaxLength(64)
    )
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Page number').setMinValue(1)
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const failedOnly = interaction.options.getBoolean('failed') ?? false;
    const source = interaction.options.getString('source') as
      | 'notification'
      | 'dynamic_delivery'
      | null;
    const invoiceId = interaction.options.getString('invoice')?.trim();
    const page = interaction.options.getInteger('page') ?? 1;

    const logs = await context.sellAuth.getWebhookLogs({
      page,
      perPage: PAGE_SIZE,
      ...(failedOnly ? { failedOnly } : {}),
      ...(source === null ? {} : { source }),
      ...(invoiceId === undefined || invoiceId === '' ? {} : { invoiceId })
    });
    const lastPage = Math.max(logs.last_page, 1);

    if (logs.data.length === 0) {
      await interaction.editReply({
        content:
          logs.total === 0
            ? 'No webhook requests match those filters.'
            : `Page ${page} is empty (last page is ${lastPage}).`
      });
      return;
    }

    const filters = [
      ...(failedOnly ? ['failed only'] : []),
      ...(source === null ? [] : [source]),
      ...(invoiceId === undefined || invoiceId === '' ? [] : [`invoice ${invoiceId}`])
    ];
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`Webhook logs (${formatCount(logs.total)})${filters.length > 0 ? ` \u2014 ${filters.join(', ')}` : ''}`)
      .setDescription(logs.data.map(logLine).join('\n\n'))
      .setFooter({ text: `Page ${logs.current_page}/${lastPage} \u00B7 URLs shown without query strings` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
