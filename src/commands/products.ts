import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatCount, formatPrice } from '../lib/format.js';
import type { ProductListQuery, ProductSummary } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const PRODUCTS_PER_PAGE = 10;
const UNLIMITED_STOCK = -1;

function priceLabel(product: ProductSummary): string {
  const variantPrices = product.variants
    .map((variant) => Number(variant.price))
    .filter((price) => Number.isFinite(price) && price > 0);

  if (variantPrices.length === 0) {
    const basePrice = Number(product.price);
    return Number.isFinite(basePrice) && basePrice > 0
      ? formatPrice(basePrice, product.currency)
      : 'no price';
  }

  const minPrice = Math.min(...variantPrices);
  const maxPrice = Math.max(...variantPrices);
  return minPrice === maxPrice
    ? formatPrice(minPrice, product.currency)
    : `${formatPrice(minPrice, product.currency)} \u2013 ${formatPrice(maxPrice, product.currency)}`;
}

function stockLabel(product: ProductSummary): string {
  const variantStocks = product.variants
    .map((variant) => variant.stock)
    .filter((stock): stock is number => stock !== null);

  if (variantStocks.length === 0) {
    const totalStock = product.stock_count;
    if (totalStock === null || totalStock === UNLIMITED_STOCK) {
      return '\u221E';
    }
    return formatCount(totalStock);
  }

  if (variantStocks.some((stock) => stock === UNLIMITED_STOCK)) {
    return '\u221E';
  }
  return formatCount(variantStocks.reduce((total, stock) => total + stock, 0));
}

function productLine(product: ProductSummary): string {
  const hiddenTag = product.visibility === 'public' ? '' : ` \u00B7 ${product.visibility}`;
  const variantCount =
    product.variants.length > 1 ? ` \u00B7 ${product.variants.length} variants` : '';
  return `**${product.name}** \u2014 ${priceLabel(product)} \u00B7 Stock: ${stockLabel(product)}${variantCount}${hiddenTag}`;
}

export const productsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('products')
    .setDescription('Browse your shop products with prices and stock')
    .addStringOption((option) =>
      option.setName('search').setDescription('Filter products by name')
    )
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Page number (10 products per page)').setMinValue(1)
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const search = interaction.options.getString('search');
    const page = interaction.options.getInteger('page') ?? 1;

    const query: ProductListQuery = {
      page,
      perPage: PRODUCTS_PER_PAGE,
      ...(search === null ? {} : { name: search })
    };
    const productPage = await context.sellAuth.getProducts(query);

    const lines = productPage.data.map(productLine);
    const emptyMessage =
      search === null
        ? 'No products on this page.'
        : `No products found matching "${search}".`;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(search === null ? 'Products' : `Products matching "${search}"`)
      .setDescription(lines.length > 0 ? lines.join('\n') : emptyMessage)
      .setFooter({
        text: `Page ${productPage.current_page}/${Math.max(productPage.last_page, 1)} \u00B7 ${formatCount(productPage.total)} products`
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
