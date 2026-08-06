import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatCount, truncate } from '../lib/format.js';
import type { ProductSummary } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const DEFAULT_LOW_STOCK_THRESHOLD = 10;
const UNLIMITED_STOCK = -1;
const PAGE_SIZE = 100;
const MAX_LINES_PER_FIELD = 15;
const MAX_NAME_LENGTH = 60;

const COLOR_OK = 0x57f287;
const COLOR_LOW = 0xfee75c;
const COLOR_OUT = 0xed4245;

interface VariantStock {
  readonly label: string;
  readonly stock: number;
}

function variantLabel(product: ProductSummary, variantName: string | null): string {
  const name =
    variantName === null || product.variants.length === 1
      ? product.name
      : `${product.name} (${variantName})`;
  return truncate(name, MAX_NAME_LENGTH);
}

async function fetchAllProducts(context: CommandContext): Promise<readonly ProductSummary[]> {
  const products: ProductSummary[] = [];
  let page = 1;
  for (;;) {
    const result = await context.sellAuth.getProducts({ page, perPage: PAGE_SIZE });
    products.push(...result.data);
    if (page >= result.last_page) {
      return products;
    }
    page += 1;
  }
}

function stockLines(entries: readonly VariantStock[], showCount: boolean): string {
  const lines = entries
    .slice(0, MAX_LINES_PER_FIELD)
    .map((entry) => (showCount ? `**${entry.label}** \u00B7 ${formatCount(entry.stock)} left` : `**${entry.label}**`));
  if (entries.length > MAX_LINES_PER_FIELD) {
    lines.push(`\u2026 and ${entries.length - MAX_LINES_PER_FIELD} more`);
  }
  return lines.join('\n');
}

export const stockCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Stock overview with low and out-of-stock warnings')
    .addIntegerOption((option) =>
      option
        .setName('threshold')
        .setDescription(`Warn when stock is at or below this number (default ${DEFAULT_LOW_STOCK_THRESHOLD})`)
        .setMinValue(1)
        .setMaxValue(10000)
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const threshold = interaction.options.getInteger('threshold') ?? DEFAULT_LOW_STOCK_THRESHOLD;
    const products = await fetchAllProducts(context);

    const outOfStock: VariantStock[] = [];
    const lowStock: VariantStock[] = [];
    let unlimitedCount = 0;
    let trackedCount = 0;

    for (const product of products) {
      for (const variant of product.variants) {
        if (variant.stock === null || variant.stock === UNLIMITED_STOCK) {
          unlimitedCount += 1;
          continue;
        }
        trackedCount += 1;
        const entry: VariantStock = {
          label: variantLabel(product, variant.name),
          stock: variant.stock
        };
        if (variant.stock === 0) {
          outOfStock.push(entry);
        } else if (variant.stock <= threshold) {
          lowStock.push(entry);
        }
      }
    }

    outOfStock.sort((a, b) => a.label.localeCompare(b.label));
    lowStock.sort((a, b) => a.stock - b.stock);

    const color = outOfStock.length > 0 ? COLOR_OUT : lowStock.length > 0 ? COLOR_LOW : COLOR_OK;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('Stock overview')
      .setFooter({
        text: `${formatCount(products.length)} products \u00B7 ${formatCount(trackedCount)} tracked variants \u00B7 ${formatCount(unlimitedCount)} with unlimited stock`
      })
      .setTimestamp();

    if (outOfStock.length === 0 && lowStock.length === 0) {
      embed.setDescription(
        trackedCount === 0
          ? 'All variants have unlimited stock — nothing to track.'
          : `All tracked variants are above the low-stock threshold of ${formatCount(threshold)}.`
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (outOfStock.length > 0) {
      embed.addFields({
        name: `Out of stock (${formatCount(outOfStock.length)})`,
        value: stockLines(outOfStock, false)
      });
    }
    if (lowStock.length > 0) {
      embed.addFields({
        name: `Low stock \u2014 ${formatCount(threshold)} or less (${formatCount(lowStock.length)})`,
        value: stockLines(lowStock, true)
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }
};
