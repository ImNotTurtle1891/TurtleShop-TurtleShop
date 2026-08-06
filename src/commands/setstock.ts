import {
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { replyWithApiError } from '../lib/apiErrors.js';
import { formatCount, truncate } from '../lib/format.js';
import { cachedProducts, resolveVariantChoice, variantChoices } from './product.js';
import { type Command, type CommandContext } from './types.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;
const UNLIMITED = -1;
const MAX_STOCK = 10_000_000;

export const setStockCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('setstock')
    .setDescription('Set the stock count of a dynamic or service product variant')
    .addStringOption((option) =>
      option
        .setName('product')
        .setDescription('The product (and variant)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('The new stock count (-1 for unlimited)')
        .setRequired(true)
        .setMinValue(UNLIMITED)
        .setMaxValue(MAX_STOCK)
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const query = interaction.options.getFocused().toLowerCase();
    const products = await cachedProducts(context);

    const matches = variantChoices(products)
      .filter((choice) => choice.label.toLowerCase().includes(query))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((choice) => ({
        name: truncate(choice.label, MAX_CHOICE_NAME_LENGTH),
        value: `${choice.product.id}:${choice.variantId}`
      }));

    await interaction.respond(matches);
  },

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const input = interaction.options.getString('product', true).trim();
    const amount = interaction.options.getInteger('amount', true);

    const products = await cachedProducts(context);
    const choice = resolveVariantChoice(input, products);
    if (choice === undefined) {
      await interaction.editReply({ content: `No product found matching "${input}".` });
      return;
    }

    if (choice.product.deliverables_type === 'serials') {
      await interaction.editReply({
        content: `**${choice.product.name}** is a serial-key product — its stock is the number of keys. Use \`/restock\` to add keys instead.`
      });
      return;
    }

    try {
      await context.sellAuth.updateVariantStock(choice.product.id, choice.variantId, amount);
    } catch (error) {
      await replyWithApiError(interaction, error, 'update the stock');
      return;
    }

    await interaction.editReply({
      content:
        amount === UNLIMITED
          ? `Stock of **${choice.label}** is now **unlimited**.`
          : `Stock of **${choice.label}** is now **${formatCount(amount)}**.`
    });
  }
};
