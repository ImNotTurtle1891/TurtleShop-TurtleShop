import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { replyWithApiError } from '../lib/apiErrors.js';
import { formatCount, formatPrice, truncate } from '../lib/format.js';
import { SellAuthApiError } from '../sellauth/client.js';
import type { Subscription } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const PAGE_SIZE = 10;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;

const STATUS_CHOICES = [
  { name: 'Active', value: 'active' },
  { name: 'Trialing', value: 'trialing' },
  { name: 'Pending', value: 'pending' },
  { name: 'Past due', value: 'past_due' },
  { name: 'Cancelled', value: 'cancelled' },
  { name: 'Expired', value: 'expired' }
] as const;

const STATUS_MARKERS: Readonly<Record<string, string>> = {
  active: '\uD83D\uDFE2',
  trialing: '\uD83D\uDD35',
  pending: '\uD83D\uDFE1',
  past_due: '\uD83D\uDFE1',
  cancelled: '\uD83D\uDD34',
  expired: '\u26AA'
};

function productLabel(subscription: Subscription): string {
  const product = subscription.product_name ?? 'Unknown product';
  return subscription.variant_name === null ? product : `${product} (${subscription.variant_name})`;
}

function priceLabel(subscription: Subscription): string {
  const amount = Number(subscription.recurring_price);
  const interval =
    subscription.interval_count > 1
      ? `${subscription.interval_count} ${subscription.interval}s`
      : subscription.interval;
  return Number.isFinite(amount)
    ? `${formatPrice(amount, subscription.currency ?? 'USD')}/${interval}`
    : `every ${interval}`;
}

function subscriptionLine(subscription: Subscription): string {
  const marker = STATUS_MARKERS[subscription.status] ?? '\u26AA';
  const parts = [
    `${marker} \`${subscription.id}\``,
    subscription.customer?.email ?? 'unknown',
    truncate(productLabel(subscription), 40),
    priceLabel(subscription)
  ];
  if (subscription.cancel_at_period_end) {
    parts.push('ends at period end');
  } else if (subscription.current_period_end !== null) {
    parts.push(`renews ${time(new Date(subscription.current_period_end), TimestampStyles.ShortDate)}`);
  }
  return parts.join(' \u00B7 ');
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const page = interaction.options.getInteger('page') ?? 1;
  const status = interaction.options.getString('status') ?? undefined;
  const subscriptions = await context.sellAuth.getSubscriptions(page, PAGE_SIZE, status);
  const lastPage = Math.max(subscriptions.last_page, 1);

  if (subscriptions.data.length === 0) {
    await interaction.editReply({
      content:
        subscriptions.total === 0
          ? status === undefined
            ? 'There are no subscriptions yet.'
            : `There are no ${status} subscriptions.`
          : `Page ${page} is empty (last page is ${lastPage}).`
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Subscriptions (${formatCount(subscriptions.total)})${status === undefined ? '' : ` \u2014 ${status}`}`)
    .setDescription(subscriptions.data.map(subscriptionLine).join('\n'))
    .setFooter({ text: `Page ${subscriptions.current_page}/${lastPage} \u00B7 Details with /subscription view` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function fetchSubscription(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<Subscription | null> {
  const id = Number(interaction.options.getString('id', true).trim());
  if (!Number.isInteger(id) || id <= 0) {
    await interaction.editReply({ content: 'That does not look like a subscription ID.' });
    return null;
  }
  try {
    return (await context.sellAuth.getSubscription(id)).subscription;
  } catch (error) {
    if (error instanceof SellAuthApiError && error.status === 404) {
      await interaction.editReply({ content: `No subscription found with ID \`${id}\`.` });
      return null;
    }
    throw error;
  }
}

async function handleView(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const subscription = await fetchSubscription(interaction, context);
  if (subscription === null) {
    return;
  }

  const marker = STATUS_MARKERS[subscription.status] ?? '\u26AA';
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Subscription ${subscription.id} \u2014 ${truncate(productLabel(subscription), 100)}`)
    .addFields(
      { name: 'Status', value: `${marker} ${subscription.status}`, inline: true },
      { name: 'Customer', value: subscription.customer?.email ?? 'unknown', inline: true },
      { name: 'Price', value: priceLabel(subscription), inline: true },
      {
        name: 'Renewal method',
        value: subscription.renewal_method ?? 'unknown',
        inline: true
      },
      {
        name: 'Started',
        value: time(new Date(subscription.created_at), TimestampStyles.ShortDate),
        inline: true
      }
    )
    .setTimestamp();

  if (subscription.current_period_end !== null) {
    embed.addFields({
      name: subscription.cancel_at_period_end ? 'Ends' : 'Renews',
      value: time(new Date(subscription.current_period_end), TimestampStyles.ShortDateTime),
      inline: true
    });
  }
  if (subscription.cancelled_at !== null) {
    embed.addFields({
      name: 'Cancelled',
      value: time(new Date(subscription.cancelled_at), TimestampStyles.ShortDateTime),
      inline: true
    });
  }
  if (subscription.failed_payment_count > 0) {
    embed.addFields({
      name: 'Failed payments',
      value: formatCount(subscription.failed_payment_count),
      inline: true
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleCancel(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const subscription = await fetchSubscription(interaction, context);
  if (subscription === null) {
    return;
  }
  if (subscription.status === 'cancelled' || subscription.status === 'expired') {
    await interaction.editReply({
      content: `Subscription \`${subscription.id}\` is already ${subscription.status}.`
    });
    return;
  }

  const immediately = interaction.options.getBoolean('immediately') ?? false;
  try {
    await context.sellAuth.cancelSubscription(subscription.id, !immediately);
  } catch (error) {
    await replyWithApiError(interaction, error, 'cancel the subscription');
    return;
  }

  const customer = subscription.customer?.email ?? 'the customer';
  await interaction.editReply({
    content: immediately
      ? `Subscription \`${subscription.id}\` (${customer}, ${truncate(productLabel(subscription), 60)}) was cancelled **immediately**.`
      : `Subscription \`${subscription.id}\` (${customer}, ${truncate(productLabel(subscription), 60)}) will end **at the end of the current period** and not renew.`
  });
}

export const subscriptionCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('subscription')
    .setDescription('View and manage customer subscriptions')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List subscriptions, newest first')
        .addStringOption((option) =>
          option
            .setName('status')
            .setDescription('Only subscriptions with this status')
            .addChoices(...STATUS_CHOICES)
        )
        .addIntegerOption((option) =>
          option.setName('page').setDescription('Page number').setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('Details of one subscription')
        .addStringOption((option) =>
          option
            .setName('id')
            .setDescription('The subscription')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('cancel')
        .setDescription('Cancel a subscription')
        .addStringOption((option) =>
          option
            .setName('id')
            .setDescription('The subscription')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addBooleanOption((option) =>
          option
            .setName('immediately')
            .setDescription('Cancel right now instead of at the end of the current period')
        )
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const query = interaction.options.getFocused().toLowerCase();
    const page = await context.sellAuth.getSubscriptions(1, MAX_AUTOCOMPLETE_CHOICES * 2);

    const matches = page.data
      .filter((subscription) =>
        `${subscription.id} ${subscription.customer?.email ?? ''} ${productLabel(subscription)}`
          .toLowerCase()
          .includes(query)
      )
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((subscription) => ({
        name: truncate(
          `#${subscription.id} \u00B7 ${subscription.customer?.email ?? 'unknown'} \u00B7 ${productLabel(subscription)} \u00B7 ${subscription.status}`,
          MAX_CHOICE_NAME_LENGTH
        ),
        value: String(subscription.id)
      }));

    await interaction.respond(matches);
  },

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    switch (interaction.options.getSubcommand()) {
      case 'list':
        await handleList(interaction, context);
        return;
      case 'view':
        await handleView(interaction, context);
        return;
      case 'cancel':
        await handleCancel(interaction, context);
        return;
      default:
        await interaction.editReply({ content: 'Unknown subcommand.' });
    }
  }
};
