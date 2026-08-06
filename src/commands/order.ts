import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandBuilder
} from 'discord.js';
import { getClaim } from '../lib/claimStore.js';
import { formatPrice, truncate } from '../lib/format.js';
import { SellAuthApiError } from '../sellauth/client.js';
import type { Invoice, InvoiceDetailItem } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const ORDER_ID_PATTERN = /^[\w-]{1,64}$/;
const MAX_ITEM_NAME_LENGTH = 60;
const MAX_FEEDBACK_MESSAGE_LENGTH = 200;

const STATUS_COLORS: Readonly<Record<string, number>> = {
  completed: 0x57f287,
  partially_completed: 0xfee75c,
  pending: 0xfee75c,
  cancelled: 0xed4245,
  expired: 0xed4245,
  refunded: 0xed4245
};

async function resolveItemName(item: InvoiceDetailItem, context: CommandContext): Promise<string> {
  if (item.product !== null) {
    const variantName = item.variant?.name;
    return variantName === null || variantName === undefined
      ? item.product.name
      : `${item.product.name} (${variantName})`;
  }
  if (item.custom_name !== null && item.custom_name !== '') {
    return item.custom_name;
  }
  // The detail endpoint often returns items without an embedded product.
  try {
    const product = await context.sellAuth.getProduct(item.product_id);
    return product.name;
  } catch {
    return `Product #${item.product_id}`;
  }
}

async function itemLine(
  item: InvoiceDetailItem,
  currency: string,
  context: CommandContext
): Promise<string> {
  const name = truncate(await resolveItemName(item, context), MAX_ITEM_NAME_LENGTH);
  const amount = Number(item.price);
  const priceLabel = Number.isFinite(amount) ? ` \u00B7 ${formatPrice(amount, currency)}` : '';
  const deliveredCount = item.delivered?.length ?? 0;
  const deliveredLabel = deliveredCount > 0 ? ` \u00B7 ${deliveredCount} delivered` : '';
  return `${item.quantity}\u00D7 **${name}**${priceLabel}${deliveredLabel}`;
}

function customerLabel(invoice: Invoice): string {
  const email = invoice.customer?.email ?? invoice.email ?? 'unknown';
  const discordId = invoice.customer?.discord_id;
  if (discordId !== null && discordId !== undefined) {
    return `${email}\n<@${discordId}>`;
  }
  const discordUsername = invoice.customer?.discord_username;
  if (discordUsername !== null && discordUsername !== undefined) {
    return `${email}\n${discordUsername}`;
  }
  return email;
}

function blacklistWarnings(invoice: Invoice): string[] {
  const status = invoice.blacklist_status;
  if (status === null) {
    return [];
  }
  const warnings: string[] = [];
  if (status.email) {
    warnings.push('email');
  }
  if (status.discord_id) {
    warnings.push('Discord account');
  }
  if (status.ip) {
    warnings.push('IP address');
  }
  return warnings;
}

async function buildOrderEmbed(invoice: Invoice, context: CommandContext): Promise<EmbedBuilder> {
  const currency = invoice.currency ?? 'USD';
  const embed = new EmbedBuilder()
    .setColor(STATUS_COLORS[invoice.status] ?? EMBED_COLOR)
    .setTitle(`Order ${invoice.unique_id}`)
    .setFooter({ text: `Invoice ID ${invoice.id}` })
    .setTimestamp();

  const paymentMethod = invoice.payment_method?.name ?? invoice.gateway ?? 'Unknown';
  const totalAmount = Number(invoice.price);
  embed.addFields(
    { name: 'Status', value: invoice.status, inline: true },
    {
      name: 'Total',
      value: Number.isFinite(totalAmount) ? formatPrice(totalAmount, currency) : 'unknown',
      inline: true
    },
    {
      name: 'Payment Method',
      value: invoice.manual ? `${paymentMethod} (manual)` : paymentMethod,
      inline: true
    },
    { name: 'Customer', value: customerLabel(invoice), inline: true },
    {
      name: 'Created',
      value: time(new Date(invoice.created_at), TimestampStyles.ShortDateTime),
      inline: true
    }
  );

  if (invoice.completed_at !== null) {
    embed.addFields({
      name: 'Completed',
      value: time(new Date(invoice.completed_at), TimestampStyles.RelativeTime),
      inline: true
    });
  }

  const itemLines = await Promise.all(
    invoice.items.map(async (item) => itemLine(item, currency, context))
  );
  embed.addFields({
    name: `Items (${invoice.items.length})`,
    value: itemLines.length > 0 ? itemLines.join('\n') : 'No items.'
  });

  if (invoice.feedback !== null) {
    const stars = '\u2605'.repeat(invoice.feedback.rating) + '\u2606'.repeat(Math.max(5 - invoice.feedback.rating, 0));
    const message =
      invoice.feedback.message === null || invoice.feedback.message === ''
        ? ''
        : ` \u2014 ${truncate(invoice.feedback.message, MAX_FEEDBACK_MESSAGE_LENGTH)}`;
    embed.addFields({ name: 'Feedback', value: `${stars}${message}` });
  }

  const claim = getClaim(String(invoice.id));
  if (claim !== undefined) {
    embed.addFields({
      name: 'Claimed By',
      value: `<@${claim.discordUserId}> ${time(new Date(claim.claimedAt), TimestampStyles.ShortDate)}`,
      inline: true
    });
  }

  if (invoice.ip !== null) {
    const country = invoice.country_code === null ? '' : ` (${invoice.country_code})`;
    embed.addFields({ name: 'IP', value: `${invoice.ip}${country}`, inline: true });
  }

  const warnings = blacklistWarnings(invoice);
  if (warnings.length > 0) {
    embed.addFields({
      name: 'Blacklist',
      value: `The customer's ${warnings.join(', ')} is on your blacklist.`
    });
  }

  return embed;
}

function addIdOption(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return subcommand.addStringOption((option) =>
    option
      .setName('id')
      .setDescription('The invoice ID (numeric or the customer-facing unique ID)')
      .setRequired(true)
      .setMaxLength(64)
  );
}

interface OrderAction {
  readonly targetStatus: string;
  readonly run: (context: CommandContext, invoiceId: number) => Promise<void>;
  readonly successMessage: string;
}

const ORDER_ACTIONS: Readonly<Record<string, OrderAction>> = {
  complete: {
    targetStatus: 'completed',
    run: async (context, invoiceId) => context.sellAuth.updateInvoiceStatus(invoiceId, 'completed'),
    successMessage: 'has been marked as **completed**.'
  },
  refund: {
    targetStatus: 'refunded',
    run: async (context, invoiceId) => context.sellAuth.refundInvoice(invoiceId),
    successMessage:
      'has been marked as **refunded**. Note: this does not return any money by itself — process the actual refund with your payment provider.'
  },
  cancel: {
    targetStatus: 'cancelled',
    run: async (context, invoiceId) => context.sellAuth.cancelInvoice(invoiceId),
    successMessage: 'has been marked as **cancelled**.'
  }
};

export const orderCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('order')
    .setDescription('Look up or manage an order by its ID')
    .addSubcommand((subcommand) =>
      addIdOption(subcommand.setName('check').setDescription('Full details of an order'))
    )
    .addSubcommand((subcommand) =>
      addIdOption(subcommand.setName('complete').setDescription('Mark an order as completed'))
    )
    .addSubcommand((subcommand) =>
      addIdOption(subcommand.setName('refund').setDescription('Mark an order as refunded'))
    )
    .addSubcommand((subcommand) =>
      addIdOption(subcommand.setName('cancel').setDescription('Mark an order as cancelled'))
    )
    .addSubcommand((subcommand) =>
      addIdOption(
        subcommand.setName('resend-email').setDescription('Resend the order confirmation email')
      ).addStringOption((option) =>
        option
          .setName('email')
          .setDescription('Send to this address instead of the one on the order')
          .setRequired(false)
          .setMaxLength(254)
      )
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const orderId = interaction.options.getString('id', true).trim();
    if (!ORDER_ID_PATTERN.test(orderId)) {
      await interaction.editReply({ content: 'That does not look like a valid order ID.' });
      return;
    }

    let invoice: Invoice;
    try {
      invoice = await context.sellAuth.getInvoice(orderId);
    } catch (error) {
      if (error instanceof SellAuthApiError && error.status === 404) {
        await interaction.editReply({ content: `No order found with ID \`${orderId}\`.` });
        return;
      }
      throw error;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'check') {
      await interaction.editReply({ embeds: [await buildOrderEmbed(invoice, context)] });
      return;
    }

    if (subcommand === 'resend-email') {
      const email = interaction.options.getString('email')?.trim();
      try {
        await context.sellAuth.resendInvoiceEmail(invoice.id, email);
      } catch (error) {
        await replyWithApiError(interaction, error, 'resend the confirmation email');
        return;
      }
      const target = email ?? invoice.customer?.email ?? invoice.email ?? 'the customer';
      await interaction.editReply({
        content: `Confirmation email for order \`${invoice.unique_id}\` was resent to **${target}**.`
      });
      return;
    }

    const action = ORDER_ACTIONS[subcommand];
    if (action === undefined) {
      await interaction.editReply({ content: 'Unknown subcommand.' });
      return;
    }

    if (invoice.status === action.targetStatus) {
      await interaction.editReply({
        content: `Order \`${invoice.unique_id}\` is already ${action.targetStatus}.`
      });
      return;
    }

    try {
      await action.run(context, invoice.id);
    } catch (error) {
      await replyWithApiError(interaction, error, `mark the order as ${action.targetStatus}`);
      return;
    }

    const updated = await context.sellAuth.getInvoice(String(invoice.id));
    await interaction.editReply({
      content: `Order \`${invoice.unique_id}\` ${action.successMessage}`,
      embeds: [await buildOrderEmbed(updated, context)]
    });
  }
};

async function replyWithApiError(
  interaction: ChatInputCommandInteraction,
  error: unknown,
  actionLabel: string
): Promise<void> {
  if (!(error instanceof SellAuthApiError)) {
    throw error;
  }
  const reason = error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`;
  await interaction.editReply({ content: `Could not ${actionLabel}: ${reason}` });
}
