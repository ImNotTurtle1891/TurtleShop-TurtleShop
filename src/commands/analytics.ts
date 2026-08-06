import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatChange, formatCount, formatUsd } from '../lib/format.js';
import {
  TIMEFRAME_LABELS,
  TIMEFRAMES,
  isTimeframe,
  timeframeToDateRange,
  type Timeframe
} from '../lib/timeframe.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const DEFAULT_TIMEFRAME: Timeframe = '30d';

export const analyticsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('analytics')
    .setDescription('Revenue, orders and customers for a timeframe')
    .addStringOption((option) =>
      option
        .setName('timeframe')
        .setDescription('Timeframe to analyze (default: last 30 days)')
        .addChoices(
          ...TIMEFRAMES.map((timeframe) => ({
            name: TIMEFRAME_LABELS[timeframe],
            value: timeframe
          }))
        )
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const rawTimeframe = interaction.options.getString('timeframe') ?? DEFAULT_TIMEFRAME;
    const timeframe: Timeframe = isTimeframe(rawTimeframe) ? rawTimeframe : DEFAULT_TIMEFRAME;

    const analytics = await context.sellAuth.getAnalytics(timeframeToDateRange(timeframe));

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`Analytics \u2014 ${TIMEFRAME_LABELS[timeframe]}`)
      .addFields(
        {
          name: 'Revenue',
          value: `${formatUsd(analytics.revenue)}\n${formatChange(analytics.revenue, analytics.previousRevenue)}`,
          inline: true
        },
        {
          name: 'Orders',
          value: `${formatCount(analytics.orders)}\n${formatChange(analytics.orders, analytics.previousOrders)}`,
          inline: true
        },
        {
          name: 'Customers',
          value: `${formatCount(analytics.customers)}\n${formatChange(analytics.customers, analytics.previousCustomers)}`,
          inline: true
        }
      )
      .setFooter({ text: 'Change is vs. the previous period of the same length' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
