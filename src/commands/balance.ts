import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandBuilder
} from 'discord.js';
import { replyWithApiError } from '../lib/apiErrors.js';
import { formatUsd, truncate } from '../lib/format.js';
import type { BalanceTransaction, CustomerSummary } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const LEDGER_PAGE_SIZE = 10;
const MAX_AMOUNT = 1000;
const MAX_DESCRIPTION_LENGTH = 100;
const DEFAULT_REASON = 'Adjusted via SellBot';

function transactionLine(transaction: BalanceTransaction): string {
  const amount = Number(transaction.amount);
  const sign = transaction.type === 'incoming' ? '+' : '\u2212';
  const label = `${sign}${formatUsd(Math.abs(amount))}`;
  const description =
    transaction.description === null || transaction.description === ''
      ? transaction.invoice_id === null
        ? 'no description'
        : `invoice #${transaction.invoice_id}`
      : truncate(transaction.description, MAX_DESCRIPTION_LENGTH);
  const when = time(new Date(transaction.created_at), TimestampStyles.ShortDate);
  return `**${label}** \u00B7 ${description} \u00B7 ${when}`;
}

async function findCustomer(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<CustomerSummary | null> {
  const email = interaction.options.getString('email', true).trim().toLowerCase();
  const customer = await context.sellAuth.findCustomerByEmail(email);
  if (customer === null) {
    await interaction.editReply({ content: `No customer found with the email **${email}**.` });
  }
  return customer;
}

async function handleView(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const customer = await findCustomer(interaction, context);
  if (customer === null) {
    return;
  }

  const page = interaction.options.getInteger('page') ?? 1;
  const ledger = await context.sellAuth.getCustomerBalanceTransactions(
    customer.id,
    page,
    LEDGER_PAGE_SIZE
  );

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Balance \u2014 ${customer.email}`)
    .addFields(
      { name: 'Current balance', value: formatUsd(Number(customer.balance)), inline: true },
      { name: 'Total spent', value: formatUsd(Number(customer.total_spent_usd)), inline: true }
    )
    .setFooter({ text: `Customer ID ${customer.id}` })
    .setTimestamp();

  if (ledger.data.length > 0) {
    embed.addFields({
      name: `Transactions \u2014 page ${ledger.current_page}/${ledger.last_page} (${ledger.total} total)`,
      value: ledger.data.map(transactionLine).join('\n')
    });
  } else {
    embed.addFields({
      name: 'Transactions',
      value: page === 1 ? 'No balance transactions yet.' : `Page ${page} is empty.`
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleAdjust(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  direction: 'add' | 'remove'
): Promise<void> {
  const customer = await findCustomer(interaction, context);
  if (customer === null) {
    return;
  }

  const amount = interaction.options.getNumber('amount', true);
  const reason = interaction.options.getString('reason')?.trim();
  const signedAmount = direction === 'add' ? amount : -amount;

  try {
    await context.sellAuth.editCustomerBalance(
      customer.id,
      signedAmount,
      reason === undefined || reason === '' ? DEFAULT_REASON : reason
    );
  } catch (error) {
    await replyWithApiError(interaction, error, `${direction} the balance`);
    return;
  }

  const updated = await context.sellAuth.findCustomerByEmail(customer.email);
  const newBalance = updated === null ? null : formatUsd(Number(updated.balance));
  await interaction.editReply({
    content:
      direction === 'add'
        ? `Added **${formatUsd(amount)}** to the balance of **${customer.email}**.${newBalance === null ? '' : ` New balance: **${newBalance}**.`}`
        : `Removed **${formatUsd(amount)}** from the balance of **${customer.email}**.${newBalance === null ? '' : ` New balance: **${newBalance}**.`}`
  });
}

function addEmailOption(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return subcommand.addStringOption((option) =>
    option
      .setName('email')
      .setDescription("The customer's email address")
      .setRequired(true)
      .setMaxLength(254)
  );
}

function addAdjustOptions(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return addEmailOption(subcommand)
    .addNumberOption((option) =>
      option
        .setName('amount')
        .setDescription(`The amount in the shop currency (max ${MAX_AMOUNT} per adjustment)`)
        .setRequired(true)
        .setMinValue(0.01)
        .setMaxValue(MAX_AMOUNT)
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Shown in the balance ledger (e.g. "Compensation for downtime")')
        .setMaxLength(255)
    );
}

export const balanceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription("View or adjust a customer's store credit")
    .addSubcommand((subcommand) =>
      addEmailOption(
        subcommand.setName('view').setDescription("A customer's balance and transaction history")
      ).addIntegerOption((option) =>
        option.setName('page').setDescription('Ledger page (default 1)').setMinValue(1)
      )
    )
    .addSubcommand((subcommand) =>
      addAdjustOptions(subcommand.setName('add').setDescription("Add store credit to a customer"))
    )
    .addSubcommand((subcommand) =>
      addAdjustOptions(
        subcommand.setName('remove').setDescription("Deduct store credit from a customer")
      )
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    switch (interaction.options.getSubcommand()) {
      case 'view':
        await handleView(interaction, context);
        return;
      case 'add':
        await handleAdjust(interaction, context, 'add');
        return;
      case 'remove':
        await handleAdjust(interaction, context, 'remove');
        return;
      default:
        await interaction.editReply({ content: 'Unknown subcommand.' });
    }
  }
};
