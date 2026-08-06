import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { replyWithApiError } from '../lib/apiErrors.js';
import { truncate } from '../lib/format.js';
import type { PaymentMethod } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;

function methodLine(method: PaymentMethod): string {
  const status = method.is_active ? '\u2705 Active' : '\u26D4 Disabled';
  const fees: string[] = [];
  if (method.percentage_fee !== null && method.percentage_fee !== 0) {
    fees.push(`${method.percentage_fee}%`);
  }
  if (method.fixed_fee !== null && method.fixed_fee !== 0) {
    fees.push(`+${method.fixed_fee}`);
  }
  const feeLabel = fees.length > 0 ? ` \u00B7 fee ${fees.join(' ')}` : '';
  return `${status} \u2014 **${method.name}** (${method.type})${feeLabel}`;
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const methods = await context.sellAuth.getPaymentMethods();
  if (methods.length === 0) {
    await interaction.editReply({ content: 'No payment methods are configured for this shop.' });
    return;
  }

  const active = methods.filter((method) => method.is_active);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Payment methods')
    .setDescription(methods.map(methodLine).join('\n'))
    .setFooter({ text: `${active.length} of ${methods.length} active` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleToggle(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const input = interaction.options.getString('method', true).trim();
  const methods = await context.sellAuth.getPaymentMethods();

  const method = /^\d+$/.test(input)
    ? methods.find((candidate) => candidate.id === Number(input))
    : methods.find((candidate) => candidate.name.toLowerCase().includes(input.toLowerCase()));
  if (method === undefined) {
    await interaction.editReply({ content: `No payment method found matching "${input}".` });
    return;
  }

  try {
    await context.sellAuth.togglePaymentMethod(method.id);
  } catch (error) {
    await replyWithApiError(interaction, error, `toggle ${method.name}`);
    return;
  }

  const nowActive = !method.is_active;
  await interaction.editReply({
    content: nowActive
      ? `**${method.name}** is now \u2705 **enabled** — customers can pay with it again.`
      : `**${method.name}** is now \u26D4 **disabled** — it no longer shows up at checkout.`
  });
}

export const paymentMethodsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('paymentmethods')
    .setDescription('View or toggle the payment methods of your shop')
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('List all payment methods and their status')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('toggle')
        .setDescription('Enable or disable a payment method')
        .addStringOption((option) =>
          option
            .setName('method')
            .setDescription('The payment method to toggle')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const query = interaction.options.getFocused().toLowerCase();
    const methods = await context.sellAuth.getPaymentMethods();

    const matches = methods
      .filter((method) => method.name.toLowerCase().includes(query))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((method) => ({
        name: truncate(
          `${method.name} (${method.type}) \u2014 ${method.is_active ? 'active' : 'disabled'}`,
          MAX_CHOICE_NAME_LENGTH
        ),
        value: String(method.id)
      }));

    await interaction.respond(matches);
  },

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (interaction.options.getSubcommand() === 'toggle') {
      await handleToggle(interaction, context);
      return;
    }
    await handleList(interaction, context);
  }
};
