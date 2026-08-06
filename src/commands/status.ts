import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandBuilder
} from 'discord.js';
import { replyWithApiError } from '../lib/apiErrors.js';
import { formatCount, truncate } from '../lib/format.js';
import type { ProductSummary } from '../sellauth/types.js';
import { cachedProducts, fetchAllProducts, resolveProductId } from './product.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;
const MAX_STATUS_TEXT_LENGTH = 255;
const MAX_GROUP_PRODUCTS_SHOWN = 20;
const ALL_PRODUCTS_VALUE = 'all';
const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

interface ColorPreset {
  readonly name: string;
  readonly marker: string;
  readonly hex: string;
}

const COLOR_PRESETS: readonly ColorPreset[] = [
  { name: 'Green', marker: '\uD83D\uDFE2', hex: '#22c55e' },
  { name: 'Yellow', marker: '\uD83D\uDFE1', hex: '#eab308' },
  { name: 'Red', marker: '\uD83D\uDD34', hex: '#ef4444' },
  { name: 'Blue', marker: '\uD83D\uDD35', hex: '#3b82f6' },
  { name: 'Gray', marker: '\u26AA', hex: '#6b7280' }
];

const TEXT_PRESETS: readonly string[] = ['Undetected', 'Working', 'Updating', 'Down', 'Maintenance'];

/** Default colors when only a status text is given, e.g. "Down" implies red. */
const TEXT_COLOR_HINTS: Readonly<Record<string, string>> = {
  undetected: '#22c55e',
  working: '#22c55e',
  online: '#22c55e',
  updating: '#eab308',
  maintenance: '#eab308',
  testing: '#eab308',
  down: '#ef4444',
  offline: '#ef4444',
  detected: '#ef4444'
};

function markerForColor(color: string | null): string {
  if (color === null) {
    return '\u26AA';
  }
  const preset = COLOR_PRESETS.find((candidate) => candidate.hex.toLowerCase() === color.toLowerCase());
  return preset?.marker ?? '\u26AA';
}

/** Accepts a preset name ("green") or a hex code ("#22c55e" / "22c55e" / "#2c5"). */
function normalizeColor(input: string): string | null {
  const preset = COLOR_PRESETS.find((candidate) => candidate.name.toLowerCase() === input.toLowerCase());
  if (preset !== undefined) {
    return preset.hex;
  }
  const match = HEX_COLOR_PATTERN.exec(input);
  if (match?.[1] === undefined) {
    return null;
  }
  const hex = match[1].toLowerCase();
  const expanded =
    hex.length === 3 ? hex.split('').map((character) => character + character).join('') : hex;
  return `#${expanded}`;
}

function resolveColor(colorInput: string | null, text: string): string | { readonly error: string } {
  if (colorInput !== null) {
    const normalized = normalizeColor(colorInput.trim());
    return normalized ?? {
      error: `"${colorInput}" is not a valid color. Use a preset (${COLOR_PRESETS.map((preset) => preset.name).join(', ')}) or a hex code like \`#ff5500\`.`
    };
  }
  return TEXT_COLOR_HINTS[text.toLowerCase()] ?? '#6b7280';
}

function badgePreview(text: string, color: string): string {
  return `${markerForColor(color)} **${text}** (\`${color}\`)`;
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const products = await fetchAllProducts(context);
  if (products.length === 0) {
    await interaction.editReply({ content: 'Your shop has no products.' });
    return;
  }

  const groups = new Map<string, { readonly color: string | null; readonly names: string[] }>();
  const noStatus: string[] = [];
  for (const product of products) {
    if (product.status_text === null || product.status_text === '') {
      noStatus.push(product.name);
      continue;
    }
    const existing = groups.get(product.status_text);
    if (existing === undefined) {
      groups.set(product.status_text, { color: product.status_color, names: [product.name] });
    } else {
      existing.names.push(product.name);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Product statuses')
    .setFooter({ text: `${formatCount(products.length)} products` })
    .setTimestamp();

  for (const [text, group] of groups) {
    const shown = group.names.slice(0, MAX_GROUP_PRODUCTS_SHOWN);
    const overflow =
      group.names.length > shown.length ? `\n\u2026 and ${group.names.length - shown.length} more` : '';
    embed.addFields({
      name: `${markerForColor(group.color)} ${text} (${group.names.length})`,
      value: truncate(shown.join(', '), 1000) + overflow
    });
  }
  if (noStatus.length > 0) {
    const shown = noStatus.slice(0, MAX_GROUP_PRODUCTS_SHOWN);
    const overflow = noStatus.length > shown.length ? `\n\u2026 and ${noStatus.length - shown.length} more` : '';
    embed.addFields({
      name: `No status (${noStatus.length})`,
      value: truncate(shown.join(', '), 1000) + overflow
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleSet(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const input = interaction.options.getString('product', true).trim();
  const text = interaction.options.getString('text', true).trim();
  const color = resolveColor(interaction.options.getString('color'), text);
  if (typeof color !== 'string') {
    await interaction.editReply({ content: color.error });
    return;
  }

  const productId = await resolveProductId(input, context);
  const products = await cachedProducts(context);
  const product = products.find((candidate) => candidate.id === productId);
  if (productId === null || product === undefined) {
    await interaction.editReply({ content: `No product found matching "${input}".` });
    return;
  }

  try {
    await context.sellAuth.updateProductStatuses({ productIds: [productId] }, text, color);
  } catch (error) {
    await replyWithApiError(interaction, error, 'update the product status');
    return;
  }
  await interaction.editReply({
    content: `Status of **${product.name}** is now ${badgePreview(text, color)}.`
  });
}

async function handleSetAll(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const text = interaction.options.getString('text', true).trim();
  const color = resolveColor(interaction.options.getString('color'), text);
  if (typeof color !== 'string') {
    await interaction.editReply({ content: color.error });
    return;
  }

  try {
    await context.sellAuth.updateProductStatuses('all', text, color);
  } catch (error) {
    await replyWithApiError(interaction, error, 'update the product statuses');
    return;
  }
  const products = await fetchAllProducts(context);
  await interaction.editReply({
    content: `All **${formatCount(products.length)}** products now show ${badgePreview(text, color)}.`
  });
}

async function handleClear(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const input = interaction.options.getString('product', true).trim();

  if (input.toLowerCase() === ALL_PRODUCTS_VALUE) {
    try {
      await context.sellAuth.updateProductStatuses('all', null, null);
    } catch (error) {
      await replyWithApiError(interaction, error, 'clear the product statuses');
      return;
    }
    await interaction.editReply({ content: 'The status badge has been removed from **all products**.' });
    return;
  }

  const productId = await resolveProductId(input, context);
  const products = await cachedProducts(context);
  const product = products.find((candidate) => candidate.id === productId);
  if (productId === null || product === undefined) {
    await interaction.editReply({ content: `No product found matching "${input}".` });
    return;
  }

  try {
    await context.sellAuth.updateProductStatuses({ productIds: [productId] }, null, null);
  } catch (error) {
    await replyWithApiError(interaction, error, 'clear the product status');
    return;
  }
  await interaction.editReply({ content: `The status badge of **${product.name}** has been removed.` });
}

function addTextAndColorOptions(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return subcommand
    .addStringOption((option) =>
      option
        .setName('text')
        .setDescription('The status text (pick a preset or type your own)')
        .setRequired(true)
        .setMaxLength(MAX_STATUS_TEXT_LENGTH)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName('color')
        .setDescription('Badge color: preset or hex like #ff5500 (default: inferred from the text)')
        .setMaxLength(24)
        .setAutocomplete(true)
    );
}

export const statusCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Manage the status badges shown on your storefront products')
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('Every product with its current status badge')
    )
    .addSubcommand((subcommand) =>
      addTextAndColorOptions(
        subcommand
          .setName('set')
          .setDescription('Set the status badge of one product')
          .addStringOption((option) =>
            option
              .setName('product')
              .setDescription('The product')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
    )
    .addSubcommand((subcommand) =>
      addTextAndColorOptions(
        subcommand.setName('set-all').setDescription('Set the status badge of every product at once')
      )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear')
        .setDescription('Remove the status badge from one product or all of them')
        .addStringOption((option) =>
          option
            .setName('product')
            .setDescription('The product, or "all"')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    const query = focused.value.toLowerCase();

    if (focused.name === 'product') {
      const products = await cachedProducts(context);
      const choices = products
        .filter((product) => product.name.toLowerCase().includes(query))
        .slice(0, MAX_AUTOCOMPLETE_CHOICES - 1)
        .map((product: ProductSummary) => ({
          name: truncate(
            product.status_text === null || product.status_text === ''
              ? product.name
              : `${product.name} \u2014 ${product.status_text}`,
            MAX_CHOICE_NAME_LENGTH
          ),
          value: String(product.id)
        }));
      if (interaction.options.getSubcommand() === 'clear' && 'all products'.includes(query)) {
        choices.unshift({ name: 'All products', value: ALL_PRODUCTS_VALUE });
      }
      await interaction.respond(choices.slice(0, MAX_AUTOCOMPLETE_CHOICES));
      return;
    }

    if (focused.name === 'text') {
      const matches = TEXT_PRESETS.filter((preset) => preset.toLowerCase().includes(query)).map(
        (preset) => ({
          name: `${markerForColor(TEXT_COLOR_HINTS[preset.toLowerCase()] ?? null)} ${preset}`,
          value: preset
        })
      );
      await interaction.respond(matches);
      return;
    }

    if (focused.name === 'color') {
      const matches = COLOR_PRESETS.filter(
        (preset) =>
          preset.name.toLowerCase().includes(query) || preset.hex.toLowerCase().includes(query)
      ).map((preset) => ({
        name: `${preset.marker} ${preset.name} (${preset.hex})`,
        value: preset.hex
      }));
      await interaction.respond(matches);
      return;
    }

    await interaction.respond([]);
  },

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    switch (interaction.options.getSubcommand()) {
      case 'list':
        await handleList(interaction, context);
        return;
      case 'set':
        await handleSet(interaction, context);
        return;
      case 'set-all':
        await handleSetAll(interaction, context);
        return;
      case 'clear':
        await handleClear(interaction, context);
        return;
      default:
        await interaction.editReply({ content: 'Unknown subcommand.' });
    }
  }
};
