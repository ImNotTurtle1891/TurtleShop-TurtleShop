import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatPrice, truncate } from '../lib/format.js';
import { SellAuthApiError } from '../sellauth/client.js';
import type { CheckoutSession, CreateCheckoutInput, ProductSummary } from '../sellauth/types.js';
import { cachedProducts } from './product.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;
const PRODUCT_VALUE_PATTERN = /^(\d+):(\d+)$/;
const DEFAULT_CURRENCY = 'USD';

interface VariantChoice {
  readonly product: ProductSummary;
  readonly variantId: number;
  readonly label: string;
}

function variantChoices(products: readonly ProductSummary[]): VariantChoice[] {
  const choices: VariantChoice[] = [];
  for (const product of products) {
    for (const variant of product.variants) {
      const name =
        variant.name === null || product.variants.length === 1
          ? product.name
          : `${product.name} (${variant.name})`;
      const price = Number(variant.price ?? product.price);
      const priceLabel = Number.isFinite(price) ? ` \u00B7 ${formatPrice(price, product.currency)}` : '';
      choices.push({ product, variantId: variant.id, label: `${name}${priceLabel}` });
    }
  }
  return choices;
}

async function createSession(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  input: CreateCheckoutInput,
  itemLabel: string
): Promise<void> {
  let session: CheckoutSession;
  try {
    session = await context.sellAuth.createCheckoutSession(input);
  } catch (error) {
    if (error instanceof SellAuthApiError) {
      const reason = error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`;
      await interaction.editReply({ content: `Could not create the invoice: ${reason}` });
      return;
    }
    throw error;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Invoice created')
    .setDescription(`**${itemLabel}**\n[Open checkout page](${session.url})\n\`${session.url}\``)
    .setFooter({ text: `Invoice ID ${session.invoice_id}` })
    .setTimestamp();

  if (input.email !== undefined) {
    embed.addFields({ name: 'Customer', value: input.email, inline: true });
  }
  if (input.coupon !== undefined) {
    embed.addFields({ name: 'Coupon', value: input.coupon, inline: true });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleProduct(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const input = interaction.options.getString('product', true).trim();
  const quantity = interaction.options.getInteger('quantity') ?? 1;
  const email = interaction.options.getString('email')?.trim().toLowerCase();
  const coupon = interaction.options.getString('coupon')?.trim();

  const products = await cachedProducts(context);
  const idMatch = PRODUCT_VALUE_PATTERN.exec(input);

  let choice: VariantChoice | undefined;
  if (idMatch !== null) {
    const productId = Number(idMatch[1]);
    const variantId = Number(idMatch[2]);
    choice = variantChoices(products).find(
      (candidate) => candidate.product.id === productId && candidate.variantId === variantId
    );
  } else {
    choice = variantChoices(products).find((candidate) =>
      candidate.label.toLowerCase().includes(input.toLowerCase())
    );
  }

  if (choice === undefined) {
    await interaction.editReply({ content: `No product found matching "${input}".` });
    return;
  }

  const checkoutInput: CreateCheckoutInput = {
    cart: [{ productId: choice.product.id, variantId: choice.variantId, quantity }],
    ...(email === undefined || email === '' ? {} : { email }),
    ...(coupon === undefined || coupon === '' ? {} : { coupon })
  };
  await createSession(
    interaction,
    context,
    checkoutInput,
    quantity > 1 ? `${quantity}\u00D7 ${choice.label}` : choice.label
  );
}

async function handleCustom(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const name = interaction.options.getString('name', true).trim();
  const price = interaction.options.getNumber('price', true);
  const currency = (interaction.options.getString('currency') ?? DEFAULT_CURRENCY).trim().toUpperCase();
  const quantity = interaction.options.getInteger('quantity') ?? 1;
  const email = interaction.options.getString('email')?.trim().toLowerCase();
  const coupon = interaction.options.getString('coupon')?.trim();

  if (!/^[A-Z]{3}$/.test(currency)) {
    await interaction.editReply({ content: 'The currency must be a 3-letter code like USD or EUR.' });
    return;
  }

  const checkoutInput: CreateCheckoutInput = {
    cart: [{ name, price, quantity }],
    currency,
    ...(email === undefined || email === '' ? {} : { email }),
    ...(coupon === undefined || coupon === '' ? {} : { coupon })
  };
  const label = `${quantity > 1 ? `${quantity}\u00D7 ` : ''}${name} \u00B7 ${formatPrice(price, currency)}`;
  await createSession(interaction, context, checkoutInput, label);
}

export const createInvoiceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('createinvoice')
    .setDescription('Create an invoice and get a checkout link to send to a customer')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('product')
        .setDescription('Invoice for a product from your catalog')
        .addStringOption((option) =>
          option
            .setName('product')
            .setDescription('The product (and variant) to sell')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption((option) =>
          option.setName('quantity').setDescription('Quantity (default 1)').setMinValue(1).setMaxValue(100000)
        )
        .addStringOption((option) =>
          option.setName('email').setDescription("Prefill the customer's email").setMaxLength(254)
        )
        .addStringOption((option) =>
          option.setName('coupon').setDescription('A coupon code to apply').setMaxLength(64)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('custom')
        .setDescription('Invoice for a one-off charge that is not in your catalog')
        .addStringOption((option) =>
          option.setName('name').setDescription('What the customer is paying for').setRequired(true).setMaxLength(255)
        )
        .addNumberOption((option) =>
          option.setName('price').setDescription('Unit price').setRequired(true).setMinValue(0.01)
        )
        .addStringOption((option) =>
          option.setName('currency').setDescription('3-letter currency code (default USD)').setMinLength(3).setMaxLength(3)
        )
        .addIntegerOption((option) =>
          option.setName('quantity').setDescription('Quantity (default 1)').setMinValue(1).setMaxValue(100000)
        )
        .addStringOption((option) =>
          option.setName('email').setDescription("Prefill the customer's email").setMaxLength(254)
        )
        .addStringOption((option) =>
          option.setName('coupon').setDescription('A coupon code to apply').setMaxLength(64)
        )
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

    if (interaction.options.getSubcommand() === 'product') {
      await handleProduct(interaction, context);
      return;
    }
    await handleCustom(interaction, context);
  }
};
