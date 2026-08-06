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
import type { AbandonedCheckout } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const PAGE_SIZE = 10;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;

function checkoutLine(checkout: AbandonedCheckout): string {
  const amount = Number(checkout.price);
  const parts = [
    `\`${checkout.unique_id}\``,
    checkout.customer?.email ?? checkout.email ?? 'no email',
    Number.isFinite(amount) ? formatPrice(amount, checkout.currency ?? 'USD') : 'unknown value',
    time(new Date(checkout.created_at), TimestampStyles.ShortDate)
  ];
  if (checkout.abandoned_recovery_sent_at !== null) {
    parts.push('recovery sent');
  }
  if (checkout.abandoned_dismissed_at !== null) {
    parts.push('dismissed');
  }
  return parts.join(' \u00B7 ');
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const page = interaction.options.getInteger('page') ?? 1;
  const checkouts = await context.sellAuth.getAbandonedCheckouts(page, PAGE_SIZE);
  const lastPage = Math.max(checkouts.last_page, 1);

  if (checkouts.data.length === 0) {
    await interaction.editReply({
      content:
        checkouts.total === 0
          ? 'No abandoned checkouts — nice.'
          : `Page ${page} is empty (last page is ${lastPage}).`
    });
    return;
  }

  const lostRevenue = checkouts.data.reduce((sum, checkout) => {
    const amount = Number(checkout.price);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Abandoned checkouts (${formatCount(checkouts.total)})`)
    .setDescription(checkouts.data.map(checkoutLine).join('\n'))
    .setFooter({
      text: `Page ${checkouts.current_page}/${lastPage} \u00B7 ~${formatPrice(lostRevenue, 'USD')} on this page \u00B7 Recover with /abandoned recover`
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleStats(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const stats = await context.sellAuth.getAbandonedCheckoutStats();

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Abandoned checkouts')
    .addFields(
      { name: 'Total', value: formatCount(stats.total), inline: true },
      { name: 'Ghosted (no payment attempt)', value: formatCount(stats.ghost_count), inline: true },
      { name: 'Dropped (payment failed/expired)', value: formatCount(stats.dropped_count), inline: true },
      { name: 'Dismissed', value: formatCount(stats.dismissed_count), inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleRecover(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const id = Number(interaction.options.getString('id', true).trim());
  if (!Number.isInteger(id) || id <= 0) {
    await interaction.editReply({
      content: 'That does not look like an abandoned checkout ID. Pick one from the autocomplete suggestions.'
    });
    return;
  }

  const couponCode = interaction.options.getString('coupon')?.trim();
  let couponId: number | undefined;
  if (couponCode !== undefined && couponCode !== '') {
    const coupons = await context.sellAuth.getCoupons(1, 100);
    const coupon = coupons.data.find(
      (candidate) => candidate.code.toUpperCase() === couponCode.toUpperCase()
    );
    if (coupon === undefined) {
      await interaction.editReply({ content: `No coupon found with code \`${couponCode}\`.` });
      return;
    }
    couponId = coupon.id;
  }

  try {
    await context.sellAuth.recoverAbandonedCheckout(id, couponId);
  } catch (error) {
    await replyWithApiError(interaction, error, 'send the recovery email');
    return;
  }

  await interaction.editReply({
    content:
      couponCode === undefined || couponCode === ''
        ? `Recovery email sent for checkout \`${id}\`.`
        : `Recovery email sent for checkout \`${id}\` with coupon \`${couponCode}\` attached.`
  });
}

export const abandonedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('abandoned')
    .setDescription('Abandoned checkouts and recovery emails')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List abandoned checkouts, newest first')
        .addIntegerOption((option) =>
          option.setName('page').setDescription('Page number').setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('stats').setDescription('Abandoned checkout counts and recovery statistics')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('recover')
        .setDescription('Send a recovery email for an abandoned checkout')
        .addStringOption((option) =>
          option
            .setName('id')
            .setDescription('The abandoned checkout')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName('coupon')
            .setDescription('Attach a coupon code as an incentive')
            .setMaxLength(64)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    const query = focused.value.toLowerCase();

    try {
      if (focused.name === 'id') {
        const checkouts = await context.sellAuth.getAbandonedCheckouts(1, MAX_AUTOCOMPLETE_CHOICES * 2);
        await interaction.respond(
          checkouts.data
            .filter((checkout) => checkout.abandoned_dismissed_at === null)
            .filter((checkout) =>
              `${checkout.unique_id} ${checkout.customer?.email ?? checkout.email ?? ''}`
                .toLowerCase()
                .includes(query)
            )
            .slice(0, MAX_AUTOCOMPLETE_CHOICES)
            .map((checkout) => {
              const amount = Number(checkout.price);
              return {
                name: truncate(
                  `${checkout.customer?.email ?? checkout.email ?? 'no email'} \u00B7 ${Number.isFinite(amount) ? formatPrice(amount, checkout.currency ?? 'USD') : '?'}${checkout.abandoned_recovery_sent_at === null ? '' : ' \u00B7 recovery sent'}`,
                  MAX_CHOICE_NAME_LENGTH
                ),
                value: String(checkout.id)
              };
            })
        );
        return;
      }

      if (focused.name === 'coupon') {
        const coupons = await context.sellAuth.getCoupons(1, 100);
        await interaction.respond(
          coupons.data
            .filter((coupon) => coupon.code.toLowerCase().includes(query))
            .slice(0, MAX_AUTOCOMPLETE_CHOICES)
            .map((coupon) => ({
              name: truncate(coupon.code, MAX_CHOICE_NAME_LENGTH),
              value: coupon.code
            }))
        );
        return;
      }
    } catch {
      // Plan-gated feature: autocomplete quietly returns nothing.
    }
    await interaction.respond([]);
  },

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      switch (interaction.options.getSubcommand()) {
        case 'list':
          await handleList(interaction, context);
          return;
        case 'stats':
          await handleStats(interaction, context);
          return;
        case 'recover':
          await handleRecover(interaction, context);
          return;
        default:
          await interaction.editReply({ content: 'Unknown subcommand.' });
          return;
      }
    } catch (error) {
      // Plan-gated feature: surface the API's message instead of a generic error.
      if (error instanceof SellAuthApiError && error.status === 403) {
        await replyWithApiError(interaction, error, 'access abandoned checkouts');
        return;
      }
      throw error;
    }
  }
};
