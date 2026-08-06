import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { claimOrder } from '../lib/orderClaims.js';
import type { Command, CommandContext } from './types.js';

export const redeemOrderCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('redeemorder')
    .setDescription('Verify your order and receive the customer role')
    .addStringOption((option) =>
      option
        .setName('orderid')
        .setDescription('Your order ID from the order confirmation')
        .setRequired(true)
        .setMaxLength(64)
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const orderId = interaction.options.getString('orderid', true);
    const result = await claimOrder(orderId, interaction.member, context);
    await interaction.editReply({ content: result.message });
  }
};
