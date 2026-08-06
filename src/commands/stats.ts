import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatCount } from '../lib/format.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

export const statsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Lifetime shop statistics from SellAuth')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const stats = await context.sellAuth.getShopStats();

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('Shop Statistics')
      .addFields(
        { name: 'Products Sold', value: formatCount(stats.products_sold), inline: true },
        { name: 'Customers', value: formatCount(stats.total_customers), inline: true },
        {
          name: 'Completed Orders',
          value: formatCount(stats.total_completed_invoices),
          inline: true
        },
        { name: 'Feedbacks', value: formatCount(stats.total_feedbacks), inline: true },
        {
          name: 'Average Rating',
          value: `${stats.average_rating.toFixed(2)} \u2B50`,
          inline: true
        }
      )
      .setFooter({ text: 'SellBot' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
