import {
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { replyWithApiError } from '../lib/apiErrors.js';
import { truncate } from '../lib/format.js';
import { cachedProducts, resolveProductId } from './product.js';
import { type Command, type CommandContext } from './types.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;

const VISIBILITY_CHOICES = [
  { name: 'Public — shown on the storefront', value: 'public' },
  { name: 'Unlisted — only reachable via direct link', value: 'unlisted' },
  { name: 'Private — hidden from customers', value: 'private' },
  { name: 'On hold — visible but not purchasable', value: 'on_hold' }
] as const;

export const productVisibilityCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('product-visibility')
    .setDescription('Change the storefront visibility of a product')
    .addStringOption((option) =>
      option
        .setName('product')
        .setDescription('The product')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName('visibility')
        .setDescription('The new visibility')
        .setRequired(true)
        .addChoices(...VISIBILITY_CHOICES)
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const query = interaction.options.getFocused().toLowerCase();
    const products = await cachedProducts(context);

    const matches = products
      .filter((product) => product.name.toLowerCase().includes(query))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((product) => ({
        name: truncate(`${product.name} \u2014 ${product.visibility}`, MAX_CHOICE_NAME_LENGTH),
        value: String(product.id)
      }));

    await interaction.respond(matches);
  },

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const input = interaction.options.getString('product', true).trim();
    const visibility = interaction.options.getString('visibility', true) as
      | 'public'
      | 'unlisted'
      | 'private'
      | 'on_hold';

    const productId = await resolveProductId(input, context);
    const products = await cachedProducts(context);
    const product = products.find((candidate) => candidate.id === productId);
    if (productId === null || product === undefined) {
      await interaction.editReply({ content: `No product found matching "${input}".` });
      return;
    }

    if (product.visibility === visibility) {
      await interaction.editReply({
        content: `**${product.name}** is already ${visibility}.`
      });
      return;
    }

    try {
      await context.sellAuth.updateProductVisibilities({ productIds: [productId] }, visibility);
    } catch (error) {
      await replyWithApiError(interaction, error, 'change the product visibility');
      return;
    }

    await interaction.editReply({
      content: `**${product.name}** is now **${visibility}** (was ${product.visibility}).`
    });
  }
};
