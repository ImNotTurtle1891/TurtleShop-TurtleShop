import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatCount, formatPrice, truncate } from '../lib/format.js';
import type { ProductSummary } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;
const MAX_VARIANT_FIELDS = 25;
const CACHE_TTL_MS = 60_000;
const CACHE_PAGE_SIZE = 100;
const UNLIMITED_STOCK = -1;

interface ProductCache {
  readonly fetchedAt: number;
  readonly products: readonly ProductSummary[];
}

let productCache: ProductCache | null = null;

export async function cachedProducts(context: CommandContext): Promise<readonly ProductSummary[]> {
  const now = Date.now();
  if (productCache !== null && now - productCache.fetchedAt < CACHE_TTL_MS) {
    return productCache.products;
  }
  const firstPage = await context.sellAuth.getProducts({ page: 1, perPage: CACHE_PAGE_SIZE });
  productCache = { fetchedAt: now, products: firstPage.data };
  return firstPage.data;
}

function variantStockLabel(stock: number | null): string {
  if (stock === null || stock === UNLIMITED_STOCK) {
    return '\u221E';
  }
  return formatCount(stock);
}

export const productCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('product')
    .setDescription('Detailed view of a single product with per-variant prices and stock')
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('The product to look up')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const query = interaction.options.getFocused().toLowerCase();
    const products = await cachedProducts(context);

    const matches = products
      .filter((product) => product.name.toLowerCase().includes(query))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((product) => ({
        name: truncate(product.name, MAX_CHOICE_NAME_LENGTH),
        value: String(product.id)
      }));

    await interaction.respond(matches);
  },

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const input = interaction.options.getString('name', true);
    const productId = await resolveProductId(input, context);
    if (productId === null) {
      await interaction.editReply({ content: `No product found matching "${input}".` });
      return;
    }

    const product = await context.sellAuth.getProduct(productId);

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(product.name)
      .setFooter({ text: `ID ${product.id} \u00B7 ${product.visibility}` })
      .setTimestamp();

    const imageUrl = product.images[0]?.url;
    if (imageUrl !== undefined) {
      embed.setThumbnail(imageUrl);
    }

    embed.addFields({
      name: 'Sold',
      value: formatCount(product.products_sold),
      inline: true
    });

    for (const variant of product.variants.slice(0, MAX_VARIANT_FIELDS - 1)) {
      const price = Number(variant.price);
      embed.addFields({
        name: variant.name ?? 'Default',
        value: `${Number.isFinite(price) ? formatPrice(price, product.currency) : 'no price'} \u00B7 Stock: ${variantStockLabel(variant.stock)}`,
        inline: true
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }
};

/**
 * Autocomplete choices carry the product ID as their value, but users can
 * also submit free text without picking a choice - fall back to a name search.
 */
async function resolveProductId(input: string, context: CommandContext): Promise<number | null> {
  if (/^\d+$/.test(input)) {
    return Number(input);
  }
  const products = await cachedProducts(context);
  const match = products.find((product) =>
    product.name.toLowerCase().includes(input.toLowerCase())
  );
  return match?.id ?? null;
}
