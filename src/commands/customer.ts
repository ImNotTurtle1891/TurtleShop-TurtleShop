import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions
} from 'discord.js';
import { formatCount, formatPrice, formatUsd, truncate } from '../lib/format.js';
import type { InvoiceListItem } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

export const CUSTOMER_PAGE_BUTTON_PREFIX = 'sellbot:customer-page:';

const ORDERS_PER_PAGE = 10;
const MAX_CUSTOM_ID_LENGTH = 100;
const MAX_PRODUCT_LABEL_LENGTH = 45;

function productLabel(invoice: InvoiceListItem): string {
  const names = invoice.items.map((item) => {
    if (item.product === null) {
      return null;
    }
    const variantName = item.variant?.name;
    return variantName === null || variantName === undefined
      ? item.product.name
      : `${item.product.name} (${variantName})`;
  });
  const joined = names.filter((name): name is string => name !== null).join(', ');
  return joined === '' ? '' : ` ${truncate(joined, MAX_PRODUCT_LABEL_LENGTH)}`;
}

function orderLine(invoice: InvoiceListItem): string {
  const amount = Number(invoice.price);
  const priceLabel = Number.isFinite(amount)
    ? formatPrice(amount, invoice.currency ?? 'USD')
    : 'unknown amount';
  const createdAt = new Date(invoice.created_at);
  const dateLabel = Number.isNaN(createdAt.getTime())
    ? ''
    : ` \u00B7 ${time(createdAt, TimestampStyles.ShortDate)}`;
  return `\`${invoice.unique_id}\`${productLabel(invoice)} \u00B7 ${priceLabel} \u00B7 ${invoice.status}${dateLabel}`;
}

function paginationRow(
  email: string,
  currentPage: number,
  lastPage: number
): ActionRowBuilder<ButtonBuilder> | null {
  if (lastPage <= 1) {
    return null;
  }

  const previousId = `${CUSTOMER_PAGE_BUTTON_PREFIX}${currentPage - 1}:${email}`;
  const nextId = `${CUSTOMER_PAGE_BUTTON_PREFIX}${currentPage + 1}:${email}`;
  if (previousId.length > MAX_CUSTOM_ID_LENGTH || nextId.length > MAX_CUSTOM_ID_LENGTH) {
    return null;
  }

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(previousId)
      .setEmoji('\u25C0')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(nextId)
      .setEmoji('\u25B6')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= lastPage)
  );
}

export async function buildCustomerView(
  context: CommandContext,
  email: string,
  page: number
): Promise<InteractionEditReplyOptions | null> {
  const customer = await context.sellAuth.findCustomerByEmail(email);
  if (customer === null) {
    return null;
  }

  const orders = await context.sellAuth.getInvoicesByEmail(email, page, ORDERS_PER_PAGE);
  const lastPage = Math.max(orders.last_page, 1);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Customer \u2014 ${customer.email}`)
    .addFields(
      { name: 'Total Spent', value: formatUsd(Number(customer.total_spent_usd)), inline: true },
      { name: 'Completed Orders', value: formatCount(customer.total_completed), inline: true },
      { name: 'Balance', value: formatUsd(Number(customer.balance)), inline: true }
    )
    .setFooter({ text: `Customer ID ${customer.id} \u00B7 Orders page ${orders.current_page}/${lastPage}` })
    .setTimestamp();

  if (customer.discord_username !== null) {
    embed.addFields({ name: 'Discord', value: customer.discord_username, inline: true });
  }
  if (customer.last_completed_at !== null) {
    embed.addFields({
      name: 'Last Purchase',
      value: time(new Date(customer.last_completed_at), TimestampStyles.ShortDate),
      inline: true
    });
  }

  const orderLines = orders.data.map(orderLine);
  embed.setDescription(
    `**Orders (${formatCount(orders.total)})**\n${orderLines.length > 0 ? orderLines.join('\n') : 'No orders on this page.'}`
  );

  const row = paginationRow(email, orders.current_page, lastPage);
  return { embeds: [embed], components: row === null ? [] : [row] };
}

export async function handleCustomerPageButton(
  interaction: ButtonInteraction,
  context: CommandContext
): Promise<void> {
  await interaction.deferUpdate();

  const state = interaction.customId.slice(CUSTOMER_PAGE_BUTTON_PREFIX.length);
  const separatorIndex = state.indexOf(':');
  const page = Number(state.slice(0, separatorIndex));
  const email = state.slice(separatorIndex + 1);
  if (!Number.isInteger(page) || page < 1 || email === '') {
    return;
  }

  const view = await buildCustomerView(context, email, page);
  if (view === null) {
    await interaction.editReply({
      content: 'This customer could not be found anymore.',
      embeds: [],
      components: []
    });
    return;
  }
  await interaction.editReply(view);
}

export const customerCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('customer')
    .setDescription('Look up a customer by email with their order history')
    .addStringOption((option) =>
      option
        .setName('email')
        .setDescription("The customer's email address")
        .setRequired(true)
        .setMaxLength(254)
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const email = interaction.options.getString('email', true).trim().toLowerCase();
    const view = await buildCustomerView(context, email, 1);
    if (view === null) {
      await interaction.editReply({ content: `No customer found with email \`${email}\`.` });
      return;
    }
    await interaction.editReply(view);
  }
};
