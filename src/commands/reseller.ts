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
import type { Reseller, ResellerTier } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const PAGE_SIZE = 10;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;

const STATUS_MARKERS: Readonly<Record<string, string>> = {
  approved: '\u2705',
  applied: '\u23F3',
  rejected: '\u274C',
  suspended: '\u26D4'
};

function resellerLine(reseller: Reseller): string {
  const marker = STATUS_MARKERS[reseller.reseller_status] ?? '';
  const tier = reseller.reseller_tier === null ? '' : ` \u00B7 ${reseller.reseller_tier.name}`;
  return `${marker} **${reseller.email}** \u00B7 ${reseller.reseller_status}${tier}\n${formatCount(reseller.reseller_total_completed)} orders \u00B7 spent ${formatUsd(Number(reseller.reseller_total_spent_usd))} \u00B7 balance ${formatUsd(Number(reseller.balance))}`;
}

async function resolveReseller(
  input: string,
  context: CommandContext
): Promise<Reseller | undefined> {
  if (/^\d+$/.test(input)) {
    const page = await context.sellAuth.getResellers(1, 100);
    const byId = page.data.find((reseller) => reseller.id === Number(input));
    if (byId !== undefined) {
      return byId;
    }
  }
  const search = await context.sellAuth.getResellers(1, PAGE_SIZE, { search: input });
  return search.data[0];
}

async function resolveTier(
  context: CommandContext,
  tierInput: string | null
): Promise<ResellerTier | undefined> {
  const tiers = await context.sellAuth.getResellerTiers();
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
  const status = interaction.options.getString('status') ?? undefined;
  const result = await context.sellAuth.getResellers(page, PAGE_SIZE, status === undefined ? {} : { status });

  if (result.data.length === 0) {
    await interaction.editReply({
      content: status === undefined ? 'No resellers yet.' : `No ${status} resellers.`
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(status === undefined ? 'Resellers' : `Resellers \u2014 ${status}`)
    .setDescription(result.data.map(resellerLine).join('\n\n'))
    .setFooter({ text: `Page ${result.current_page}/${result.last_page} \u00B7 ${result.total} resellers` })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleStats(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const stats = await context.sellAuth.getResellerStats();
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Reseller program')
    .addFields(
      {
        name: 'Resellers',
        value: `${formatCount(stats.total_resellers)} total\n${formatCount(stats.active_resellers)} active \u00B7 ${formatCount(stats.new_resellers)} new`,
        inline: true
      },
      {
        name: `Revenue (${stats.window_days}d)`,
        value: `${formatUsd(stats.revenue_usd)}\n${formatChange(stats.revenue_usd, stats.revenue_usd_previous)} \u00B7 all-time ${formatUsd(stats.revenue_usd_all_time)}`,
        inline: true
      },
      {
        name: 'Orders (all-time)',
        value: formatCount(stats.orders_all_time),
        inline: true
      },
      {
        name: 'Pending applications',
        value: formatCount(stats.pending_applications),
        inline: true
      }
    )
    .setTimestamp();

  if (stats.top_performers.length > 0) {
    embed.addFields({
      name: 'Top performers',
      value: stats.top_performers
        .slice(0, 5)
        .map(
          (reseller) =>
            `**${reseller.email}** \u00B7 ${formatCount(reseller.reseller_total_completed)} orders \u00B7 ${formatUsd(Number(reseller.reseller_total_spent_usd))}`
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
  const input = interaction.options.getString('reseller', true).trim();
  const reseller = await resolveReseller(input, context);
  if (reseller === undefined) {
    await interaction.editReply({ content: `No reseller found matching "${input}".` });
    return;
  }

  const detail = await context.sellAuth.getReseller(reseller.id);
  const marker = STATUS_MARKERS[detail.reseller.reseller_status] ?? '';
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Reseller \u2014 ${detail.reseller.email}`)
    .addFields(
      { name: 'Status', value: `${marker} ${detail.reseller.reseller_status}`, inline: true },
      { name: 'Tier', value: detail.reseller.reseller_tier?.name ?? 'default', inline: true },
      { name: 'Balance', value: formatUsd(Number(detail.reseller.balance)), inline: true },
      {
        name: 'Reseller orders',
        value: formatCount(detail.reseller.reseller_total_completed),
        inline: true
      },
      {
        name: 'Total spent',
        value: formatUsd(Number(detail.reseller.reseller_total_spent_usd)),
        inline: true
      }
    )
    .setFooter({ text: `Customer ID ${detail.reseller.id}` })
    .setTimestamp();

  if (detail.reseller.reseller_approved_at !== null) {
    embed.addFields({
      name: 'Approved',
      value: time(new Date(detail.reseller.reseller_approved_at), TimestampStyles.ShortDate),
      inline: true
    });
  }
  if (
    detail.reseller.reseller_application_answer !== null &&
    detail.reseller.reseller_application_answer !== ''
  ) {
    embed.addFields({
      name: 'Application answer',
      value: truncate(detail.reseller.reseller_application_answer, 500)
    });
  }
  if (detail.orders.length > 0) {
    embed.addFields({
      name: 'Recent orders',
      value: detail.orders
        .slice(0, 5)
        .map(
          (order) =>
            `\`${order.unique_id}\` \u00B7 ${order.status} \u00B7 ${time(new Date(order.created_at), TimestampStyles.ShortDate)}`
        )
        .join('\n')
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function handleInvite(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const email = interaction.options.getString('email', true).trim().toLowerCase();
  const tier = await resolveTier(context, interaction.options.getString('tier'));
  if (tier === undefined) {
    await interaction.editReply({
      content: 'No reseller tiers exist yet. Create one in your SellAuth dashboard under Resellers first.'
    });
    return;
  }

  try {
    await context.sellAuth.inviteReseller(email, tier.id);
  } catch (error) {
    await replyWithApiError(interaction, error, 'invite the reseller');
    return;
  }
  await interaction.editReply({
    content: `**${email}** is now an approved reseller in the **${tier.name}** tier (${tier.discount_percentage}% discount).`
  });
}

async function handleDecision(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  action: 'approve' | 'reject' | 'suspend' | 'restore'
): Promise<void> {
  const input = interaction.options.getString('reseller', true).trim();
  const reseller = await resolveReseller(input, context);
  if (reseller === undefined) {
    await interaction.editReply({ content: `No reseller found matching "${input}".` });
    return;
  }

  try {
    switch (action) {
      case 'approve': {
        const tier = await resolveTier(context, interaction.options.getString('tier'));
        if (tier === undefined) {
          await interaction.editReply({
            content: 'No reseller tiers exist yet. Create one in your SellAuth dashboard under Resellers first.'
          });
          return;
        }
        await context.sellAuth.approveReseller(reseller.id, tier.id);
        await interaction.editReply({
          content: `**${reseller.email}** has been approved as a reseller in the **${tier.name}** tier. The customer has been notified.`
        });
        return;
      }
      case 'reject':
        await context.sellAuth.rejectReseller(reseller.id);
        await interaction.editReply({
          content: `The reseller application of **${reseller.email}** has been rejected. The customer has been notified.`
        });
        return;
      case 'suspend':
        await context.sellAuth.suspendReseller(reseller.id);
        await interaction.editReply({
          content: `**${reseller.email}** has been suspended as a reseller. Use \`/reseller restore\` to undo.`
        });
        return;
      case 'restore':
        await context.sellAuth.restoreReseller(reseller.id);
        await interaction.editReply({
          content: `**${reseller.email}** has been restored and is an active reseller again.`
        });
        return;
    }
  } catch (error) {
    await replyWithApiError(interaction, error, `${action} the reseller`);
  }
}

export const resellerCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('reseller')
    .setDescription('Manage your reseller program')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List resellers with their status, orders and spend')
        .addStringOption((option) =>
          option
            .setName('status')
            .setDescription('Filter by status (default: all)')
            .addChoices(
              { name: 'Applied (pending)', value: 'applied' },
              { name: 'Approved', value: 'approved' },
              { name: 'Rejected', value: 'rejected' },
              { name: 'Suspended', value: 'suspended' }
            )
        )
        .addIntegerOption((option) =>
          option.setName('page').setDescription('Page number (default 1)').setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('stats').setDescription('Aggregate stats for your reseller program')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('Details of one reseller: profile, application and recent orders')
        .addStringOption((option) =>
          option.setName('reseller').setDescription('The reseller (search by email)').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('invite')
        .setDescription('Approve a customer as a reseller immediately')
        .addStringOption((option) =>
          option.setName('email').setDescription("The reseller's email").setRequired(true).setMaxLength(254)
        )
        .addStringOption((option) =>
          option.setName('tier').setDescription('The tier to place them in (default: the default tier)').setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('approve')
        .setDescription('Approve a pending reseller application')
        .addStringOption((option) =>
          option.setName('reseller').setDescription('The applicant (search by email)').setRequired(true).setAutocomplete(true)
        )
        .addStringOption((option) =>
          option.setName('tier').setDescription('The tier to place them in (default: the default tier)').setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reject')
        .setDescription('Reject a pending reseller application')
        .addStringOption((option) =>
          option.setName('reseller').setDescription('The applicant (search by email)').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('suspend')
        .setDescription('Suspend a reseller (reversible)')
        .addStringOption((option) =>
          option.setName('reseller').setDescription('The reseller (search by email)').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('restore')
        .setDescription('Lift the suspension of a reseller')
        .addStringOption((option) =>
          option.setName('reseller').setDescription('The reseller (search by email)').setRequired(true).setAutocomplete(true)
        )
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    const query = focused.value.toLowerCase();

    try {
      if (focused.name === 'reseller') {
        const page = await context.sellAuth.getResellers(
          1,
          MAX_AUTOCOMPLETE_CHOICES,
          query === '' ? {} : { search: query }
        );
        await interaction.respond(
          page.data.map((reseller) => ({
            name: truncate(`${reseller.email} \u00B7 ${reseller.reseller_status}`, MAX_CHOICE_NAME_LENGTH),
            value: String(reseller.id)
          }))
        );
        return;
      }

      if (focused.name === 'tier') {
        const tiers = await context.sellAuth.getResellerTiers();
        await interaction.respond(
          tiers
            .filter((tier) => tier.name.toLowerCase().includes(query))
            .slice(0, MAX_AUTOCOMPLETE_CHOICES)
            .map((tier) => ({
              name: truncate(
                `${tier.name} \u00B7 ${tier.discount_percentage}% discount${tier.is_default ? ' (default)' : ''}`,
                MAX_CHOICE_NAME_LENGTH
              ),
              value: String(tier.id)
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
        case 'view':
          await handleView(interaction, context);
          return;
        case 'invite':
          await handleInvite(interaction, context);
          return;
        case 'approve':
          await handleDecision(interaction, context, 'approve');
          return;
        case 'reject':
          await handleDecision(interaction, context, 'reject');
          return;
        case 'suspend':
          await handleDecision(interaction, context, 'suspend');
          return;
        case 'restore':
          await handleDecision(interaction, context, 'restore');
          return;
        default:
          await interaction.editReply({ content: 'Unknown subcommand.' });
          return;
      }
    } catch (error) {
      // Plan-gated feature: surface the API's message instead of a generic error.
      if (error instanceof SellAuthApiError && error.status === 403) {
        await replyWithApiError(interaction, error, 'access the reseller program');
        return;
      }
      throw error;
    }
  }
};
