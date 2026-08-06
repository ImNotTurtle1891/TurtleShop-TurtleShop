import {
  EmbedBuilder,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Message
} from 'discord.js';
import { formatCount, truncate } from '../lib/format.js';
import { SellAuthApiError } from '../sellauth/client.js';
import { cachedProducts, resolveVariantChoice, variantChoices } from './product.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;
const WAIT_FOR_KEYS_MS = 5 * 60_000;
const MAX_KEYS_PER_RESTOCK = 10_000;
const SERIALS_TYPE = 'serials';

function parseKeys(raw: string): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const part of raw.split(/[\r\n,]+/)) {
    const key = part.trim();
    if (key !== '' && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** Prefers an attached text file over the message body, for large restocks. */
async function extractRawKeys(message: Message): Promise<string> {
  const attachment = message.attachments.find(
    (candidate) =>
      candidate.contentType?.startsWith('text/') === true ||
      candidate.name.toLowerCase().endsWith('.txt')
  );
  if (attachment !== undefined) {
    const response = await fetch(attachment.url);
    return response.text();
  }
  return message.content;
}

export const restockCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('restock')
    .setDescription('Add serial keys to a product: send the keys in your next message')
    .addStringOption((option) =>
      option
        .setName('product')
        .setDescription('The product (and variant) to restock')
        .setRequired(true)
        .setAutocomplete(true)
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
    await interaction.deferReply();

    if (!interaction.inCachedGuild() || interaction.channel === null) {
      await interaction.editReply({ content: 'This command only works in a server text channel.' });
      return;
    }
    const channel = interaction.channel;

    const input = interaction.options.getString('product', true).trim();
    const products = await cachedProducts(context);
    const choice = resolveVariantChoice(input, products);
    if (choice === undefined) {
      await interaction.editReply({ content: `No product found matching "${input}".` });
      return;
    }

    if (choice.product.deliverables_type !== SERIALS_TYPE) {
      await interaction.editReply({
        content: `**${choice.product.name}** is a ${choice.product.deliverables_type ?? 'unknown'}-type product. Only products with serial-key delivery can be restocked this way.`
      });
      return;
    }

    const promptEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`Restocking ${choice.label}`)
      .setDescription(
        [
          `${interaction.user.toString()}, send the new stock in your **next message** in this channel.`,
          '',
          '• Separate each key with a comma (`,`) or a new line',
          '• You can also attach a `.txt` file for large restocks',
          '• Type `cancel` to abort',
          '',
          'Your message will be deleted after the keys are added. This expires in 5 minutes.'
        ].join('\n')
      );
    await interaction.editReply({ embeds: [promptEmbed] });

    const collected = await channel.awaitMessages({
      filter: (message) => message.author.id === interaction.user.id,
      max: 1,
      time: WAIT_FOR_KEYS_MS
    });
    const message = collected.first();
    if (message === undefined) {
      await interaction.editReply({
        content: `Restock of **${choice.label}** timed out — no keys were sent within 5 minutes.`,
        embeds: []
      });
      return;
    }

    const deleteKeysMessage = async (): Promise<boolean> =>
      message
        .delete()
        .then(() => true)
        .catch(() => false);

    if (message.content.trim().toLowerCase() === 'cancel') {
      await deleteKeysMessage();
      await interaction.editReply({
        content: `Restock of **${choice.label}** cancelled.`,
        embeds: []
      });
      return;
    }

    const keys = parseKeys(await extractRawKeys(message));
    if (keys.length === 0) {
      await deleteKeysMessage();
      await interaction.editReply({
        content: 'No keys found in that message. Run `/restock` again and send the keys as plain text or a `.txt` attachment.',
        embeds: []
      });
      return;
    }
    if (keys.length > MAX_KEYS_PER_RESTOCK) {
      await deleteKeysMessage();
      await interaction.editReply({
        content: `That is ${formatCount(keys.length)} keys — the limit per restock is ${formatCount(MAX_KEYS_PER_RESTOCK)}. Split it into multiple restocks.`,
        embeds: []
      });
      return;
    }

    try {
      const before = await context.sellAuth.getDeliverables(choice.product.id, choice.variantId);
      await context.sellAuth.appendDeliverables(choice.product.id, choice.variantId, keys);
      const after = await context.sellAuth.getDeliverables(choice.product.id, choice.variantId);
      const deleted = await deleteKeysMessage();

      const resultEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('Product restocked')
        .setDescription(`**${choice.label}**`)
        .addFields(
          { name: 'Keys added', value: formatCount(keys.length), inline: true },
          {
            name: 'Stock',
            value: `${formatCount(before.length)} \u2192 **${formatCount(after.length)}**`,
            inline: true
          }
        )
        .setFooter({ text: `Product ID ${choice.product.id} \u00B7 Variant ID ${choice.variantId}` })
        .setTimestamp();

      await interaction.editReply({
        content: deleted
          ? ''
          : '\u26A0\uFE0F Could not delete your message with the keys — remove it manually. Give the bot the **Manage Messages** permission to automate this.',
        embeds: [resultEmbed]
      });
    } catch (error) {
      await deleteKeysMessage();
      if (error instanceof SellAuthApiError) {
        const reason = error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`;
        await interaction.editReply({
          content: `Could not restock **${choice.label}**: ${reason}`,
          embeds: []
        });
        return;
      }
      throw error;
    }
  }
};
