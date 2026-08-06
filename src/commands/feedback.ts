import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatCount, truncate } from '../lib/format.js';
import { SellAuthApiError } from '../sellauth/client.js';
import type { FeedbackListItem } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const FEEDBACKS_PER_PAGE = 10;
const MAX_MESSAGE_PREVIEW = 90;
const RATING_BAR_WIDTH = 12;

function stars(rating: number): string {
  return '\u2605'.repeat(rating) + '\u2606'.repeat(Math.max(5 - rating, 0));
}

function productLabel(feedback: FeedbackListItem): string | null {
  const name = feedback.invoice?.items[0]?.product?.name;
  return name === undefined ? null : name;
}

function feedbackLine(feedback: FeedbackListItem): string {
  const parts = [`${stars(feedback.rating)} \`${feedback.id}\``];
  if (feedback.message !== null && feedback.message !== '') {
    parts.push(`"${truncate(feedback.message, MAX_MESSAGE_PREVIEW)}"`);
  }
  const product = productLabel(feedback);
  if (product !== null) {
    parts.push(product);
  }
  parts.push(time(new Date(feedback.created_at), TimestampStyles.ShortDate));
  if (feedback.is_automatic) {
    parts.push('auto');
  }
  if (feedback.reply !== null) {
    parts.push('replied');
  }
  return parts.join(' \u00B7 ');
}

async function handleRecent(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const page = interaction.options.getInteger('page') ?? 1;
  const rating = interaction.options.getInteger('rating');
  const writtenOnly = interaction.options.getBoolean('written') ?? false;

  const feedbacks = await context.sellAuth.getFeedbacks({
    page,
    perPage: FEEDBACKS_PER_PAGE,
    ...(rating === null ? {} : { rating }),
    ...(writtenOnly ? { writtenOnly } : {})
  });
  const lastPage = Math.max(feedbacks.last_page, 1);

  if (feedbacks.data.length === 0) {
    await interaction.editReply({
      content:
        feedbacks.total === 0
          ? 'No feedbacks match those filters.'
          : `Page ${page} is empty (last page is ${lastPage}).`
    });
    return;
  }

  const filters = [
    ...(rating === null ? [] : [`${rating}\u2605`]),
    ...(writtenOnly ? ['written only'] : [])
  ];
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Feedback (${formatCount(feedbacks.total)})${filters.length > 0 ? ` \u2014 ${filters.join(', ')}` : ''}`)
    .setDescription(feedbacks.data.map(feedbackLine).join('\n'))
    .setFooter({ text: `Page ${feedbacks.current_page}/${lastPage} \u00B7 Reply with /feedback reply` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleStats(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const stats = await context.sellAuth.getFeedbackStats();

  const maxCount = Math.max(...Object.values(stats.by_rating), 1);
  const ratingLines = [5, 4, 3, 2, 1].map((rating) => {
    const count = stats.by_rating[String(rating)] ?? 0;
    const bar = '\u2588'.repeat(Math.round((count / maxCount) * RATING_BAR_WIDTH));
    return `${rating}\u2605 ${bar} ${formatCount(count)}`;
  });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Feedback statistics')
    .setDescription(ratingLines.join('\n'))
    .addFields(
      { name: 'Total', value: formatCount(stats.total), inline: true },
      { name: 'Average', value: `${stats.average_rating} ${stars(Math.round(stats.average_rating))}`, inline: true },
      { name: 'Written', value: formatCount(stats.total - stats.automatic), inline: true },
      { name: 'Replied', value: `${formatCount(stats.replied)} (${stats.reply_rate}%)`, inline: true },
      { name: 'Pending Disputes', value: formatCount(stats.pending_disputes), inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleReply(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const id = interaction.options.getInteger('id', true);
  const message = interaction.options.getString('message', true).trim();

  try {
    await context.sellAuth.replyToFeedback(id, message);
  } catch (error) {
    if (error instanceof SellAuthApiError) {
      const reason =
        error.status === 404
          ? `no feedback found with ID \`${id}\``
          : (error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`);
      await interaction.editReply({ content: `Could not send the reply: ${reason}` });
      return;
    }
    throw error;
  }

  await interaction.editReply({
    content: `Reply posted on feedback \`${id}\`:\n> ${truncate(message, 500)}`
  });
}

export const feedbackCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('feedback')
    .setDescription('Browse and reply to product reviews')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('recent')
        .setDescription('Recent feedback, newest first')
        .addIntegerOption((option) =>
          option.setName('page').setDescription('Page number').setMinValue(1)
        )
        .addIntegerOption((option) =>
          option.setName('rating').setDescription('Only this star rating').setMinValue(1).setMaxValue(5)
        )
        .addBooleanOption((option) =>
          option.setName('written').setDescription('Only reviews the customer actually wrote (no automatic ones)')
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('stats').setDescription('Rating breakdown, averages, and reply rate')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reply')
        .setDescription('Post a public reply to a feedback')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('The feedback ID (shown in /feedback recent)').setRequired(true).setMinValue(1)
        )
        .addStringOption((option) =>
          option.setName('message').setDescription('Your reply, shown publicly on your shop').setRequired(true).setMaxLength(1000)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dispute')
        .setDescription('Dispute an unfair feedback so SellAuth staff review it')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('The feedback ID (shown in /feedback recent)').setRequired(true).setMinValue(1)
        )
        .addStringOption((option) =>
          option.setName('reason').setDescription('Why this feedback should be removed').setRequired(true).setMaxLength(1000)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('cancel-dispute')
        .setDescription('Cancel a pending dispute on a feedback')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('The feedback ID').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('purge-automatic')
        .setDescription('Delete ALL automatic (system-generated) feedbacks — irreversible')
        .addBooleanOption((option) =>
          option
            .setName('confirm')
            .setDescription('Set to True to confirm the deletion')
            .setRequired(true)
        )
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    switch (interaction.options.getSubcommand()) {
      case 'recent':
        await handleRecent(interaction, context);
        return;
      case 'stats':
        await handleStats(interaction, context);
        return;
      case 'reply':
        await handleReply(interaction, context);
        return;
      case 'dispute':
        await handleDispute(interaction, context);
        return;
      case 'cancel-dispute':
        await handleCancelDispute(interaction, context);
        return;
      case 'purge-automatic':
        await handlePurgeAutomatic(interaction, context);
        return;
      default:
        await interaction.editReply({ content: 'Unknown subcommand.' });
    }
  }
};

async function handleDispute(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const id = interaction.options.getInteger('id', true);
  const reason = interaction.options.getString('reason', true).trim();

  try {
    await context.sellAuth.disputeFeedback(id, reason);
  } catch (error) {
    if (error instanceof SellAuthApiError) {
      const detail =
        error.status === 404
          ? `no feedback found with ID \`${id}\``
          : (error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`);
      await interaction.editReply({ content: `Could not dispute the feedback: ${detail}` });
      return;
    }
    throw error;
  }

  await interaction.editReply({
    content: `Feedback \`${id}\` has been disputed — SellAuth staff will review it. Reason:\n> ${truncate(reason, 500)}`
  });
}

async function handlePurgeAutomatic(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const stats = await context.sellAuth.getFeedbackStats();
  if (stats.automatic === 0) {
    await interaction.editReply({ content: 'There are no automatic feedbacks to delete.' });
    return;
  }

  if (!interaction.options.getBoolean('confirm', true)) {
    await interaction.editReply({
      content: `This would permanently delete **${formatCount(stats.automatic)}** automatic feedback(s). Run the command again with \`confirm: True\` to proceed.`
    });
    return;
  }

  try {
    await context.sellAuth.deleteAutomaticFeedbacks();
  } catch (error) {
    if (error instanceof SellAuthApiError) {
      const reason = error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`;
      await interaction.editReply({ content: `Could not delete the automatic feedbacks: ${reason}` });
      return;
    }
    throw error;
  }

  await interaction.editReply({
    content: `Deleted **${formatCount(stats.automatic)}** automatic feedback(s). Customer-written reviews were not touched.`
  });
}

async function handleCancelDispute(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const id = interaction.options.getInteger('id', true);

  try {
    await context.sellAuth.cancelFeedbackDispute(id);
  } catch (error) {
    if (error instanceof SellAuthApiError) {
      const detail =
        error.status === 404
          ? `no feedback found with ID \`${id}\``
          : (error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`);
      await interaction.editReply({ content: `Could not cancel the dispute: ${detail}` });
      return;
    }
    throw error;
  }

  await interaction.editReply({ content: `The dispute on feedback \`${id}\` has been cancelled.` });
}
