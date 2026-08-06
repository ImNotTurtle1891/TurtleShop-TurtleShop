import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatChange, formatCount } from '../lib/format.js';
import {
  TIMEFRAME_LABELS,
  TIMEFRAMES,
  isTimeframe,
  timeframeToDateRange,
  type Timeframe
} from '../lib/timeframe.js';
import type { TrafficMetric } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const DEFAULT_TIMEFRAME: Timeframe = '30d';
const MAX_UTM_ROWS = 5;

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(Math.round(totalSeconds), 0);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function utmField(entries: readonly TrafficMetric[]): string | null {
  const rows = entries
    .filter((entry) => entry.x !== null && entry.x !== '')
    .slice(0, MAX_UTM_ROWS)
    .map((entry) => `**${entry.x}** \u00B7 ${formatCount(entry.y)}`);
  return rows.length > 0 ? rows.join('\n') : null;
}

export const trafficCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('traffic')
    .setDescription('Live visitors, traffic stats and UTM breakdown for your storefront')
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
    const range = timeframeToDateRange(timeframe);

    const [activeVisitors, stats, utm] = await Promise.all([
      context.sellAuth.getActiveVisitors(),
      context.sellAuth.getTrafficStats(range),
      context.sellAuth.getTrafficUtm(range)
    ]);

    const bounceRate = stats.visits > 0 ? (stats.bounces / stats.visits) * 100 : 0;
    const previousBounceRate =
      stats.comparison.visits > 0 ? (stats.comparison.bounces / stats.comparison.visits) * 100 : 0;
    const averageVisitSeconds = stats.visits > 0 ? stats.totaltime / stats.visits : 0;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`Traffic \u2014 ${TIMEFRAME_LABELS[timeframe]}`)
      .addFields(
        { name: 'Active right now', value: `\uD83D\uDFE2 ${formatCount(activeVisitors)}`, inline: true },
        {
          name: 'Visitors',
          value: `${formatCount(stats.visitors)}\n${formatChange(stats.visitors, stats.comparison.visitors)}`,
          inline: true
        },
        {
          name: 'Visits',
          value: `${formatCount(stats.visits)}\n${formatChange(stats.visits, stats.comparison.visits)}`,
          inline: true
        },
        {
          name: 'Pageviews',
          value: `${formatCount(stats.pageviews)}\n${formatChange(stats.pageviews, stats.comparison.pageviews)}`,
          inline: true
        },
        {
          name: 'Bounce rate',
          value: `${bounceRate.toFixed(1)}%\n${formatChange(bounceRate, previousBounceRate)}`,
          inline: true
        },
        { name: 'Avg. visit time', value: formatDuration(averageVisitSeconds), inline: true }
      )
      .setFooter({ text: 'Change is vs. the previous period of the same length' })
      .setTimestamp();

    const utmSections: ReadonlyArray<readonly [string, readonly TrafficMetric[]]> = [
      ['UTM sources', utm.utm_source],
      ['UTM campaigns', utm.utm_campaign]
    ];
    for (const [name, entries] of utmSections) {
      const value = utmField(entries);
      if (value !== null) {
        embed.addFields({ name, value, inline: true });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  }
};
