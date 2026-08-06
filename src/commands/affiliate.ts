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
import { formatChange, formatCount, formatUsd, truncate } from '../lib/format.js';
import { SellAuthApiError } from '../sellauth/client.js';
import type { Affiliate, AffiliatePayoutRequest, AffiliateTier } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const PAGE_SIZE = 10;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;

function affiliateLine(affiliate: Affiliate): string {
  const code = affiliate.affiliate_code ?? 'no code';
  const tier = affiliate.affiliate_tier === null ? '' : ` \u00B7 ${affiliate.affiliate_tier.name}`;
  return `**${affiliate.email}** \u00B7 \`${code}\`${tier}\n${formatCount(affiliate.referrals_count)} referrals \u00B7 earned ${formatUsd(Number(affiliate.affiliate_referrer_earnings))} \u00B7 balance ${formatUsd(Number(affiliate.affiliate_balance))}`;
}

function payoutLine(payout: AffiliatePayoutRequest): string {
  const email = payout.shop_customer?.email ?? `customer #${payout.shop_customer_id}`;
  const details =
    payout.payout_details === null || payout.payout_details === ''
      ? ''
      : `\n${truncate(payout.payout_details, 100)}`;
  return `**#${payout.id}** \u00B7 ${email} \u00B7 ${formatUsd(Number(payout.amount))} \u00B7 ${payout.status} \u00B7 ${time(new Date(payout.created_at), TimestampStyles.ShortDate)}${details}`;
}

async function resolveAffiliateId(
  input: string,
  context: CommandContext
): Promise<Affiliate | undefined> {
  if (/^\d+$/.test(input)) {
    const page = await context.sellAuth.getAffiliates(1, 100);
    const byId = page.data.find((affiliate) => affiliate.id === Number(input));
    if (byId !== undefined) {
      return byId;
    }
  }
  const search = await context.sellAuth.getAffiliates(1, PAGE_SIZE, input);
  return search.data[0];
}

async function defaultTier(
  context: CommandContext,
  tierInput: string | null
): Promise<AffiliateTier | undefined> {
  const tiers = await context.sellAuth.getAffiliateTiers();
  if (tierInput !== null) {
    return /^\d+$/.test(tierInput)
      ? tiers.find((tier) => tier.id === Number(tierInput))
      : tiers.find((tier) => tier.name.toLowerCase().includes(tierInput.toLowerCase()));
  }
  return tiers.find((tier) => tier.is_default) ?? tiers[0];
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const page = interaction.options.getInteger('page') ?? 1;
  const search = interaction.options.getString('search')?.trim();
  const result = await context.sellAuth.getAffiliates(page, PAGE_SIZE, search);

  if (result.data.length === 0) {
    await interaction.editReply({
      content: search === undefined ? 'No affiliates yet.' : `No affiliates found matching "${search}".`
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(search === undefined ? 'Affiliates' : `Affiliates matching "${search}"`)
    .setDescription(result.data.map(affiliateLine).join('\n\n'))
    .setFooter({ text: `Page ${result.current_page}/${result.last_page} \u00B7 ${result.total} affiliates` })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleStats(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const stats = await context.sellAuth.getAffiliateStats();
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Affiliate program')
    .addFields(
      {
        name: 'Affiliates',
        value: `${formatCount(stats.total_affiliates)} total\n${formatCount(stats.active_affiliates)} active \u00B7 ${formatCount(stats.new_affiliates)} new`,
        inline: true
      },
      {
        name: `Commissions (${stats.window_days}d)`,
        value: `${formatUsd(stats.commissions_usd)}\n${formatChange(stats.commissions_usd, stats.commissions_usd_previous)} \u00B7 all-time ${formatUsd(stats.commissions_usd_all_time)}`,
        inline: true
      },
      {
        name: `Referral revenue (${stats.window_days}d)`,
        value: `${formatUsd(stats.referral_revenue_usd)}\n${formatChange(stats.referral_revenue_usd, stats.referral_revenue_usd_previous)} \u00B7 all-time ${formatUsd(stats.referral_revenue_usd_all_time)}`,
        inline: true
      },
      {
        name: 'Avg. commission rate',
        value: `${stats.average_commission_rate.toFixed(1)}%`,
        inline: true
      },
      { name: 'Top earner', value: formatUsd(stats.top_earner_usd), inline: true },
      { name: 'Pending payouts', value: formatCount(stats.pending_payout_requests), inline: true }
    )
    .setTimestamp();

  if (stats.top_performers.length > 0) {
    embed.addFields({
      name: 'Top performers',
      value: stats.top_performers
        .slice(0, 5)
        .map(
          (affiliate) =>
            `**${affiliate.email}** \u00B7 ${formatCount(affiliate.referrals_count)} referrals \u00B7 ${formatUsd(Number(affiliate.affiliate_referrer_earnings))}`
        )
        .join('\n')
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function handleView(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const input = interaction.options.getString('affiliate', true).trim();
  const affiliate = await resolveAffiliateId(input, context);
  if (affiliate === undefined) {
    await interaction.editReply({ content: `No affiliate found matching "${input}".` });
    return;
  }

  const detail = await context.sellAuth.getAffiliate(affiliate.id);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Affiliate \u2014 ${detail.affiliate.email}`)
    .addFields(
      { name: 'Code', value: `\`${detail.affiliate.affiliate_code ?? 'none'}\``, inline: true },
      { name: 'Tier', value: detail.affiliate.affiliate_tier?.name ?? 'default', inline: true },
      { name: 'Referrals', value: formatCount(detail.affiliate.referrals_count), inline: true },
      {
        name: 'Earned (all-time)',
        value: formatUsd(Number(detail.affiliate.affiliate_referrer_earnings)),
        inline: true
      },
      {
        name: 'Balance',
        value: formatUsd(Number(detail.affiliate.affiliate_balance)),
        inline: true
      },
      {
        name: 'Attributed orders',
        value: formatCount(detail.attributed_invoices.length),
        inline: true
      }
    )
    .setFooter({ text: `Customer ID ${detail.affiliate.id}` })
    .setTimestamp();

  if (detail.affiliate.affiliate_code_set_at !== null) {
    embed.addFields({
      name: 'Affiliate since',
      value: time(new Date(detail.affiliate.affiliate_code_set_at), TimestampStyles.ShortDate),
      inline: true
    });
  }

  const pendingPayouts = detail.payout_requests.filter((payout) => payout.status === 'pending');
  if (pendingPayouts.length > 0) {
    embed.addFields({
      name: `Pending payout requests (${pendingPayouts.length})`,
      value: pendingPayouts.slice(0, 5).map(payoutLine).join('\n')
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function handleInvite(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const email = interaction.options.getString('email', true).trim().toLowerCase();
  const code = interaction.options.getString('code', true).trim();
  const tier = await defaultTier(context, interaction.options.getString('tier'));
  if (tier === undefined) {
    await interaction.editReply({
      content: 'No affiliate tiers exist yet. Create one in your SellAuth dashboard under Affiliates first.'
    });
    return;
  }

  try {
    await context.sellAuth.inviteAffiliate(email, code, tier.id);
  } catch (error) {
    await replyWithApiError(interaction, error, 'invite the affiliate');
    return;
  }
  await interaction.editReply({
    content: `**${email}** is now an affiliate with code \`${code}\` in the **${tier.name}** tier (${tier.percentage}% commission).`
  });
}

async function handleSuspendOrRestore(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  action: 'suspend' | 'restore'
): Promise<void> {
  const input = interaction.options.getString('affiliate', true).trim();
  const affiliate = await resolveAffiliateId(input, context);
  if (affiliate === undefined) {
    await interaction.editReply({ content: `No affiliate found matching "${input}".` });
    return;
  }

  try {
    if (action === 'suspend') {
      await context.sellAuth.suspendAffiliate(affiliate.id);
    } else {
      await context.sellAuth.restoreAffiliate(affiliate.id);
    }
  } catch (error) {
    await replyWithApiError(interaction, error, `${action} the affiliate`);
    return;
  }
  await interaction.editReply({
    content:
      action === 'suspend'
        ? `**${affiliate.email}** has been suspended — their links no longer attribute and they stop earning. Use \`/affiliate restore\` to undo.`
        : `**${affiliate.email}** has been restored and is an active affiliate again.`
  });
}

async function handlePayouts(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const rawStatus = interaction.options.getString('status');
  const status =
    rawStatus === 'pending' || rawStatus === 'paid' || rawStatus === 'rejected' || rawStatus === 'cancelled'
      ? rawStatus
      : undefined;
  const result = await context.sellAuth.getAffiliatePayouts(PAGE_SIZE, status);

  if (result.data.length === 0) {
    await interaction.editReply({
      content: status === undefined ? 'No payout requests yet.' : `No ${status} payout requests.`
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(status === undefined ? 'Affiliate payout requests' : `Affiliate payout requests \u2014 ${status}`)
    .setDescription(result.data.map(payoutLine).join('\n\n'))
    .setFooter({ text: `${result.total} total \u00B7 approve with /affiliate payout-pay, reject with /affiliate payout-reject` })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handlePayoutDecision(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  decision: 'pay' | 'reject'
): Promise<void> {
  const payoutId = Number(interaction.options.getString('payout', true).trim().replace(/^#/, ''));
  if (!Number.isInteger(payoutId) || payoutId <= 0) {
    await interaction.editReply({ content: 'That does not look like a valid payout request ID.' });
    return;
  }

  try {
    if (decision === 'pay') {
      await context.sellAuth.payAffiliatePayout(payoutId);
    } else {
      await context.sellAuth.rejectAffiliatePayout(
        payoutId,
        interaction.options.getString('note')?.trim()
      );
    }
  } catch (error) {
    await replyWithApiError(interaction, error, `${decision === 'pay' ? 'approve' : 'reject'} the payout request`);
    return;
  }
  await interaction.editReply({
    content:
      decision === 'pay'
        ? `Payout request **#${payoutId}** marked as **paid**. Remember: the actual money moves outside SellAuth — send it per the payout details.`
        : `Payout request **#${payoutId}** **rejected** — the amount was refunded to the affiliate's balance.`
  });
}

export const affiliateCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('affiliate')
    .setDescription('Manage your affiliate program')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List affiliates with their codes, referrals and earnings')
        .addIntegerOption((option) =>
          option.setName('page').setDescription('Page number (default 1)').setMinValue(1)
        )
        .addStringOption((option) =>
          option.setName('search').setDescription('Search by email or affiliate code').setMaxLength(100)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('stats').setDescription('Aggregate stats for your affiliate program')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('Details of one affiliate: earnings, referrals and payout requests')
        .addStringOption((option) =>
          option
            .setName('affiliate')
            .setDescription('The affiliate (search by email)')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('invite')
        .setDescription('Make a customer an affiliate with a code')
        .addStringOption((option) =>
          option.setName('email').setDescription("The affiliate's email").setRequired(true).setMaxLength(254)
        )
        .addStringOption((option) =>
          option.setName('code').setDescription('The affiliate code to assign (e.g. PARTNER10)').setRequired(true).setMaxLength(64)
        )
        .addStringOption((option) =>
          option.setName('tier').setDescription('The tier to place them in (default: the default tier)').setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('suspend')
        .setDescription('Suspend an affiliate (reversible, keeps their history)')
        .addStringOption((option) =>
          option.setName('affiliate').setDescription('The affiliate (search by email)').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('restore')
        .setDescription('Lift the suspension of an affiliate')
        .addStringOption((option) =>
          option.setName('affiliate').setDescription('The affiliate (search by email)').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('payouts')
        .setDescription('List affiliate payout requests')
        .addStringOption((option) =>
          option
            .setName('status')
            .setDescription('Filter by status (default: all)')
            .addChoices(
              { name: 'Pending', value: 'pending' },
              { name: 'Paid', value: 'paid' },
              { name: 'Rejected', value: 'rejected' },
              { name: 'Cancelled', value: 'cancelled' }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('payout-pay')
        .setDescription('Approve a pending payout request (mark as paid)')
        .addStringOption((option) =>
          option.setName('payout').setDescription('The payout request').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('payout-reject')
        .setDescription('Reject a pending payout request (refunds the affiliate balance)')
        .addStringOption((option) =>
          option.setName('payout').setDescription('The payout request').setRequired(true).setAutocomplete(true)
        )
        .addStringOption((option) =>
          option.setName('note').setDescription('Optional note shown to the affiliate').setMaxLength(255)
        )
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    const query = focused.value.toLowerCase();

    if (focused.name === 'affiliate') {
      const page = await context.sellAuth.getAffiliates(1, MAX_AUTOCOMPLETE_CHOICES, query === '' ? undefined : query);
      await interaction.respond(
        page.data.map((affiliate) => ({
          name: truncate(`${affiliate.email} \u00B7 ${affiliate.affiliate_code ?? 'no code'}`, MAX_CHOICE_NAME_LENGTH),
          value: String(affiliate.id)
        }))
      );
      return;
    }

    if (focused.name === 'tier') {
      const tiers = await context.sellAuth.getAffiliateTiers();
      await interaction.respond(
        tiers
          .filter((tier) => tier.name.toLowerCase().includes(query))
          .slice(0, MAX_AUTOCOMPLETE_CHOICES)
          .map((tier) => ({
            name: truncate(`${tier.name} \u00B7 ${tier.percentage}%${tier.is_default ? ' (default)' : ''}`, MAX_CHOICE_NAME_LENGTH),
            value: String(tier.id)
          }))
      );
      return;
    }

    if (focused.name === 'payout') {
      const payouts = await context.sellAuth.getAffiliatePayouts(MAX_AUTOCOMPLETE_CHOICES, 'pending');
      await interaction.respond(
        payouts.data
          .filter((payout) =>
            `${payout.id} ${payout.shop_customer?.email ?? ''}`.toLowerCase().includes(query)
          )
          .slice(0, MAX_AUTOCOMPLETE_CHOICES)
          .map((payout) => ({
            name: truncate(
              `#${payout.id} \u00B7 ${payout.shop_customer?.email ?? 'unknown'} \u00B7 ${formatUsd(Number(payout.amount))}`,
              MAX_CHOICE_NAME_LENGTH
            ),
            value: String(payout.id)
          }))
      );
      return;
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
        case 'view':
          await handleView(interaction, context);
          return;
        case 'invite':
          await handleInvite(interaction, context);
          return;
        case 'suspend':
          await handleSuspendOrRestore(interaction, context, 'suspend');
          return;
        case 'restore':
          await handleSuspendOrRestore(interaction, context, 'restore');
          return;
        case 'payouts':
          await handlePayouts(interaction, context);
          return;
        case 'payout-pay':
          await handlePayoutDecision(interaction, context, 'pay');
          return;
        case 'payout-reject':
          await handlePayoutDecision(interaction, context, 'reject');
          return;
        default:
          await interaction.editReply({ content: 'Unknown subcommand.' });
          return;
      }
    } catch (error) {
      // Plan-gated feature: surface the API's message instead of a generic error.
      if (error instanceof SellAuthApiError && error.status === 403) {
        await replyWithApiError(interaction, error, 'access the affiliate program');
        return;
      }
      throw error;
    }
  }
};
