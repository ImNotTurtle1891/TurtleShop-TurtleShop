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

  if (invoice.dashboard_note !== null && invoice.dashboard_note !== '') {
    embed.addFields({ name: 'Note', value: truncate(invoice.dashboard_note, 1024) });
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
  /** Returns a message explaining why the action cannot run, or null when it can. */
  readonly guard?: (invoice: Invoice) => string | null;
  readonly run: (
    context: CommandContext,
    invoice: Invoice,
    interaction: ChatInputCommandInteraction
  ) => Promise<void>;
  readonly successMessage: (interaction: ChatInputCommandInteraction) => string;
  /** Used in the error reply: "Could not <errorLabel>: ..." */
  readonly errorLabel: string;
}

function alreadyStatusGuard(status: string): (invoice: Invoice) => string | null {
  return (invoice) => (invoice.status === status ? `is already ${status}` : null);
}

const ORDER_ACTIONS: Readonly<Record<string, OrderAction>> = {
  complete: {
    guard: alreadyStatusGuard('completed'),
    run: async (context, invoice) =>
      context.sellAuth.updateInvoiceStatus(invoice.id, 'completed'),
    successMessage: () => 'has been marked as **completed**.',
    errorLabel: 'mark the order as completed'
  },
  refund: {
    guard: alreadyStatusGuard('refunded'),
    run: async (context, invoice) => context.sellAuth.refundInvoice(invoice.id),
    successMessage: () =>
      'has been marked as **refunded**. Note: this does not return any money by itself — process the actual refund with your payment provider.',
    errorLabel: 'mark the order as refunded'
  },
  cancel: {
    guard: alreadyStatusGuard('cancelled'),
    run: async (context, invoice) => context.sellAuth.cancelInvoice(invoice.id),
    successMessage: () => 'has been marked as **cancelled**.',
    errorLabel: 'mark the order as cancelled'
  },
  unrefund: {
    guard: (invoice) => (invoice.status === 'refunded' ? null : 'is not marked as refunded'),
    run: async (context, invoice) => context.sellAuth.unrefundInvoice(invoice.id),
    successMessage: () => 'is no longer marked as refunded.',
    errorLabel: 'unrefund the order'
  },
  process: {
    guard: alreadyStatusGuard('completed'),
    run: async (context, invoice, interaction) =>
      context.sellAuth.processInvoice(
        invoice.id,
        interaction.options.getBoolean('mark_as_paid') ?? false
      ),
    successMessage: (interaction) =>
      interaction.options.getBoolean('mark_as_paid') === true
        ? 'has been processed — marked as paid and its items delivered.'
        : 'has been processed — its items have been delivered.',
    errorLabel: 'process the order'
  },
  deliver: {
    run: async (context, invoice) => context.sellAuth.deliverInvoice(invoice.id),
    successMessage: () => 'items have been re-delivered and the customer has been notified.',
    errorLabel: 're-deliver the order'
  },
  note: {
    run: async (context, invoice, interaction) =>
      context.sellAuth.updateInvoiceDashboardNote(
        invoice.id,
        interaction.options.getString('text', true).trim()
      ),
    successMessage: () => 'dashboard note has been updated.',
    errorLabel: 'update the dashboard note'
  },
  ship: {
    run: async (context, invoice, interaction) => {
      const code = interaction.options.getString('tracking_code')?.trim();
      const link = interaction.options.getString('tracking_link')?.trim();
      const tracking: { code?: string; link?: string } = {};
      if (code !== undefined && code !== '') {
        tracking.code = code;
      }
      if (link !== undefined && link !== '') {
        tracking.link = link;
      }
      await context.sellAuth.shipInvoice(invoice.id, tracking);
    },
    successMessage: () => 'has been marked as **shipped**.',
    errorLabel: 'mark the order as shipped'
  },
  archive: {
    guard: (invoice) => (invoice.archived_at !== null ? 'is already archived' : null),
    run: async (context, invoice) => context.sellAuth.archiveInvoice(invoice.id),
    successMessage: () => 'has been archived.',
    errorLabel: 'archive the order'
  },
  unarchive: {
    guard: (invoice) => (invoice.archived_at === null ? 'is not archived' : null),
    run: async (context, invoice) => context.sellAuth.unarchiveInvoice(invoice.id),
    successMessage: () => 'has been unarchived.',
    errorLabel: 'unarchive the order'
  },
  'reverse-cashback': {
    run: async (context, invoice) => context.sellAuth.reverseCashback(invoice.id),
    successMessage: () =>
      'cashback has been reversed. The customer balance may go negative if it was already spent.',
    errorLabel: 'reverse the cashback'
  },
  'reverse-affiliate-commission': {
    run: async (context, invoice) => context.sellAuth.reverseAffiliateCommission(invoice.id),
    successMessage: () => 'affiliate commission has been reversed.',
    errorLabel: 'reverse the affiliate commission'
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
    )
    .addSubcommand((subcommand) =>
      addIdOption(
        subcommand
          .setName('process')
          .setDescription('Deliver the items of a stuck pending or out-of-stock order')
      ).addBooleanOption((option) =>
        option
          .setName('mark_as_paid')
          .setDescription('Also mark the order as paid')
          .setRequired(false)
      )
    )
    .addSubcommand((subcommand) =>
      addIdOption(
        subcommand
          .setName('deliver')
          .setDescription('Re-deliver the order items and notify the customer')
      )
    )
    .addSubcommand((subcommand) =>
      addIdOption(
        subcommand.setName('note').setDescription('Set the dashboard note of an order')
      ).addStringOption((option) =>
        option
          .setName('text')
          .setDescription('The note text')
          .setRequired(true)
          .setMaxLength(1000)
      )
    )
    .addSubcommand((subcommand) =>
      addIdOption(
        subcommand
          .setName('ship')
          .setDescription('Mark an order as shipped, optionally with tracking info')
      )
        .addStringOption((option) =>
          option
            .setName('tracking_code')
            .setDescription('The shipment tracking code')
            .setRequired(false)
            .setMaxLength(100)
        )
        .addStringOption((option) =>
          option
            .setName('tracking_link')
            .setDescription('A link to track the shipment')
            .setRequired(false)
            .setMaxLength(500)
        )
    )
    .addSubcommand((subcommand) =>
      addIdOption(
        subcommand.setName('unrefund').setDescription('Remove the refunded status from an order')
      )
    )
    .addSubcommand((subcommand) =>
      addIdOption(subcommand.setName('archive').setDescription('Archive an order'))
    )
    .addSubcommand((subcommand) =>
      addIdOption(subcommand.setName('unarchive').setDescription('Unarchive an order'))
    )
    .addSubcommand((subcommand) =>
      addIdOption(
        subcommand
          .setName('reverse-cashback')
          .setDescription('Reverse the cashback earned on an order (e.g. after a chargeback)')
      )
    )
    .addSubcommand((subcommand) =>
      addIdOption(
        subcommand
          .setName('reverse-affiliate-commission')
          .setDescription('Reverse the affiliate commission earned on an order')
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

    const blocked = action.guard?.(invoice) ?? null;
    if (blocked !== null) {
      await interaction.editReply({ content: `Order \`${invoice.unique_id}\` ${blocked}.` });
      return;
    }

    try {
      await action.run(context, invoice, interaction);
    } catch (error) {
      await replyWithApiError(interaction, error, action.errorLabel);
      return;
    }

    const updated = await context.sellAuth.getInvoice(String(invoice.id));
    await interaction.editReply({
      content: `Order \`${invoice.unique_id}\` ${action.successMessage(interaction)}`,
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
