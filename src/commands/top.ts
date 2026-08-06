import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandBuilder
} from 'discord.js';
import { formatCount, formatUsd, maskEmail } from '../lib/format.js';
import {
  TIMEFRAME_LABELS,
  TIMEFRAMES,
  isTimeframe,
  timeframeToDateRange,
  type Timeframe
} from '../lib/timeframe.js';
import type { DateRange } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const DEFAULT_TIMEFRAME: Timeframe = '30d';

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'] as const;

function rankPrefix(index: number): string {
  return MEDALS[index] ?? `${index + 1}.`;
}

function withTimeframeOption(
  subcommand: SlashCommandSubcommandBuilder
): SlashCommandSubcommandBuilder {
  return subcommand.addStringOption((option) =>
    option
      .setName('timeframe')
      .setDescription('Timeframe to analyze (default: last 30 days)')
      .addChoices(
        ...TIMEFRAMES.map((timeframe) => ({
          name: TIMEFRAME_LABELS[timeframe],
          value: timeframe
        }))
      )
  );
}

async function buildProductLines(context: CommandContext, range: DateRange): Promise<string[]> {
  const products = await context.sellAuth.getTopProducts(range);
  return products.map((product, index) => {
    const variant = product.variant_name === null ? '' : ` (${product.variant_name})`;
    return `${rankPrefix(index)} **${product.product_name}${variant}** \u2014 ${formatUsd(product.total_revenue_usd)} \u00B7 ${formatCount(product.total_orders)} orders`;
  });
}

async function buildCustomerLines(context: CommandContext, range: DateRange): Promise<string[]> {
  const customers = await context.sellAuth.getTopCustomers(range);
  return customers.map((customer, index) => {
    const identity = customer.discord_username ?? maskEmail(customer.email);
    return `${rankPrefix(index)} **${identity}** \u2014 ${formatUsd(Number(customer.total_spent_usd))} \u00B7 ${formatCount(customer.total_completed)} orders`;
  });
}

async function buildPaymentMethodLines(
  context: CommandContext,
  range: DateRange
): Promise<string[]> {
  const paymentMethods = await context.sellAuth.getTopPaymentMethods(range);
  return paymentMethods.map((method, index) => {
    return `${rankPrefix(index)} **${method.name}** \u2014 ${formatUsd(method.total_revenue_usd)} \u00B7 ${formatCount(method.total_orders)} orders`;
  });
}

export const topCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Top performers by revenue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      withTimeframeOption(
        subcommand.setName('products').setDescription('Top 10 products by revenue')
      )
    )
    .addSubcommand((subcommand) =>
      withTimeframeOption(
        subcommand.setName('customers').setDescription('Top 10 customers by revenue')
      )
    )
    .addSubcommand((subcommand) =>
      withTimeframeOption(
        subcommand.setName('payment-methods').setDescription('Top payment methods by revenue')
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

    const subcommand = interaction.options.getSubcommand();
    let title: string;
    let lines: string[];

    switch (subcommand) {
      case 'products':
        title = 'Top Products';
        lines = await buildProductLines(context, range);
        break;
      case 'customers':
        title = 'Top Customers';
        lines = await buildCustomerLines(context, range);
        break;
      case 'payment-methods':
        title = 'Top Payment Methods';
        lines = await buildPaymentMethodLines(context, range);
        break;
      default:
        throw new Error(`Unknown /top subcommand: ${subcommand}`);
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`${title} \u2014 ${TIMEFRAME_LABELS[timeframe]}`)
      .setDescription(lines.length > 0 ? lines.join('\n') : 'No data for this timeframe.')
      .setFooter({ text: 'SellBot' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
