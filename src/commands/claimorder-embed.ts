import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { CLAIM_ORDER_BUTTON_ID } from '../lib/claimInteractions.js';
import { EMBED_COLOR, type Command } from './types.js';

export const claimOrderEmbedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('claimorder-embed')
    .setDescription('Post the order-claim embed with a button in this channel'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const channel = interaction.channel;
    if (channel === null || !channel.isSendable()) {
      await interaction.reply({
        content: 'The claim embed cannot be posted in this channel.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('Claim Your Order')
      .setDescription(
        'Bought something from our shop? Click the button below and enter your order ID to receive the customer role.'
      )
      .setFooter({ text: 'Your order ID is in your order confirmation email' });

    const claimButton = new ButtonBuilder()
      .setCustomId(CLAIM_ORDER_BUTTON_ID)
      .setLabel('Claim Order')
      .setStyle(ButtonStyle.Primary);

    await channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(claimButton)]
    });

    await interaction.reply({ content: 'Claim embed posted.', flags: MessageFlags.Ephemeral });
  }
};
