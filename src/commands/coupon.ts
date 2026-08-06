import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatCount, formatUsd, truncate } from '../lib/format.js';
import { SellAuthApiError } from '../sellauth/client.js';
import type { Coupon, CreateCouponInput, UpdateCouponInput } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const COUPON_CODE_PATTERN = /^[\w-]{1,64}$/;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;
const CACHE_TTL_MS = 60_000;
const CACHE_PAGE_SIZE = 100;
const COUPONS_PER_PAGE = 15;
const MAX_EXPIRY_DAYS = 3650;

interface CouponCache {
  readonly fetchedAt: number;
  readonly coupons: readonly Coupon[];
}

let couponCache: CouponCache | null = null;

async function cachedCoupons(context: CommandContext): Promise<readonly Coupon[]> {
  const now = Date.now();
  if (couponCache !== null && now - couponCache.fetchedAt < CACHE_TTL_MS) {
    return couponCache.coupons;
  }
  const firstPage = await context.sellAuth.getCoupons(1, CACHE_PAGE_SIZE);
  couponCache = { fetchedAt: now, coupons: firstPage.data };
  return firstPage.data;
}

function invalidateCouponCache(): void {
  couponCache = null;
}

function discountLabel(coupon: Coupon): string {
  const amount = Number(coupon.discount);
  return coupon.type === 'percentage' ? `${amount}% off` : `${formatUsd(amount)} off`;
}

function usesLabel(coupon: Coupon): string {
  const uses = formatCount(coupon.uses);
  return coupon.max_uses === null ? `${uses} uses` : `${uses}/${formatCount(coupon.max_uses)} uses`;
}

function couponLine(coupon: Coupon): string {
  const parts = [`\`${coupon.code}\``, discountLabel(coupon), usesLabel(coupon)];
  if (Number(coupon.total_saved) > 0) {
    parts.push(`${formatUsd(Number(coupon.total_saved))} saved`);
  }
  if (coupon.expiration_date !== null) {
    parts.push(`expires ${time(new Date(coupon.expiration_date), TimestampStyles.ShortDate)}`);
  }
  if (!coupon.global) {
    parts.push('product-specific');
  }
  return parts.join(' \u00B7 ');
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const page = interaction.options.getInteger('page') ?? 1;
  const coupons = await context.sellAuth.getCoupons(page, COUPONS_PER_PAGE);
  const lastPage = Math.max(coupons.last_page, 1);

  if (coupons.data.length === 0) {
    await interaction.editReply({
      content: coupons.total === 0 ? 'There are no coupons yet.' : `Page ${page} is empty (last page is ${lastPage}).`
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Coupons (${formatCount(coupons.total)})`)
    .setDescription(coupons.data.map(couponLine).join('\n'))
    .setFooter({ text: `Page ${coupons.current_page}/${lastPage}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleCreate(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const code = interaction.options.getString('code', true).trim().toUpperCase();
  const discount = interaction.options.getNumber('discount', true);
  const type = interaction.options.getString('type', true) as 'percentage' | 'fixed';

  if (!COUPON_CODE_PATTERN.test(code)) {
    await interaction.editReply({
      content: 'Coupon codes can only contain letters, numbers, hyphens and underscores.'
    });
    return;
  }
  if (type === 'percentage' && discount > 100) {
    await interaction.editReply({ content: 'A percentage discount cannot exceed 100%.' });
    return;
  }

  const existing = (await cachedCoupons(context)).find(
    (coupon) => coupon.code.toUpperCase() === code
  );
  if (existing !== undefined) {
    await interaction.editReply({ content: `A coupon with code \`${existing.code}\` already exists.` });
    return;
  }

  const input: CreateCouponInput = {
    code,
    discount,
    type,
    ...optionalInt(interaction, 'max_uses', 'maxUses'),
    ...optionalInt(interaction, 'max_uses_per_customer', 'maxUsesPerCustomer'),
    ...optionalNumber(interaction, 'min_order', 'minInvoicePrice'),
    ...expirationDate(interaction)
  };

  try {
    await context.sellAuth.createCoupon(input);
  } catch (error) {
    if (error instanceof SellAuthApiError) {
      const reason = error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`;
      await interaction.editReply({ content: `Could not create the coupon: ${reason}` });
      return;
    }
    throw error;
  }
  invalidateCouponCache();

  const details = [
    type === 'percentage' ? `${discount}% off` : `${formatUsd(discount)} off`,
    'all products'
  ];
  if (input.maxUses !== undefined) {
    details.push(`max ${formatCount(input.maxUses)} uses`);
  }
  if (input.maxUsesPerCustomer !== undefined) {
    details.push(`${formatCount(input.maxUsesPerCustomer)} per customer`);
  }
  if (input.minInvoicePrice !== undefined) {
    details.push(`min order ${formatUsd(input.minInvoicePrice)}`);
  }
  if (input.expirationDate !== undefined) {
    details.push(`expires ${input.expirationDate}`);
  }
  await interaction.editReply({ content: `Coupon \`${code}\` created: ${details.join(', ')}.` });
}

async function handleEdit(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const code = interaction.options.getString('code', true).trim();
  const coupon = (await cachedCoupons(context)).find(
    (candidate) => candidate.code.toUpperCase() === code.toUpperCase()
  );
  if (coupon === undefined) {
    await interaction.editReply({ content: `No coupon found with code \`${code}\`.` });
    return;
  }
  if (!coupon.global) {
    await interaction.editReply({
      content: `\`${coupon.code}\` is a product-specific coupon — edit it in the dashboard so its product list is preserved.`
    });
    return;
  }

  const newDiscount = interaction.options.getNumber('discount');
  const newType = interaction.options.getString('type') as 'percentage' | 'fixed' | null;
  const newMaxUses = interaction.options.getInteger('max_uses');
  const newMaxUsesPerCustomer = interaction.options.getInteger('max_uses_per_customer');
  const newMinOrder = interaction.options.getNumber('min_order');
  const expiresInDays = interaction.options.getInteger('expires_in_days');
  const clearExpiry = interaction.options.getBoolean('clear_expiry') ?? false;

  if (
    newDiscount === null &&
    newType === null &&
    newMaxUses === null &&
    newMaxUsesPerCustomer === null &&
    newMinOrder === null &&
    expiresInDays === null &&
    !clearExpiry
  ) {
    await interaction.editReply({ content: 'Nothing to change — provide at least one option.' });
    return;
  }

  const type = newType ?? (coupon.type === 'percentage' ? 'percentage' : 'fixed');
  const discount = newDiscount ?? Number(coupon.discount);
  if (type === 'percentage' && discount > 100) {
    await interaction.editReply({ content: 'A percentage discount cannot exceed 100%.' });
    return;
  }

  let expirationDate: string | null = coupon.expiration_date?.slice(0, 10) ?? null;
  if (clearExpiry) {
    expirationDate = null;
  } else if (expiresInDays !== null) {
    expirationDate = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  const input: UpdateCouponInput = {
    code: coupon.code,
    global: true,
    discount,
    type,
    maxUses: newMaxUses ?? coupon.max_uses,
    maxUsesPerCustomer: newMaxUsesPerCustomer ?? coupon.max_uses_per_customer,
    minInvoicePrice:
      newMinOrder ?? (coupon.min_invoice_price === null ? null : Number(coupon.min_invoice_price)),
    expirationDate
  };

  try {
    await context.sellAuth.updateCoupon(coupon.id, input);
  } catch (error) {
    if (error instanceof SellAuthApiError) {
      const reason = error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`;
      await interaction.editReply({ content: `Could not update the coupon: ${reason}` });
      return;
    }
    throw error;
  }
  invalidateCouponCache();

  const details = [
    input.type === 'percentage' ? `${input.discount}% off` : `${formatUsd(input.discount)} off`,
    input.maxUses === null ? 'unlimited uses' : `max ${formatCount(input.maxUses)} uses`,
    ...(input.maxUsesPerCustomer === null ? [] : [`${formatCount(input.maxUsesPerCustomer)} per customer`]),
    ...(input.minInvoicePrice === null ? [] : [`min order ${formatUsd(input.minInvoicePrice)}`]),
    input.expirationDate === null ? 'no expiry' : `expires ${input.expirationDate}`
  ];
  await interaction.editReply({ content: `Coupon \`${coupon.code}\` updated: ${details.join(', ')}.` });
}

async function handleDelete(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const code = interaction.options.getString('code', true).trim();
  const coupon = (await cachedCoupons(context)).find(
    (candidate) => candidate.code.toUpperCase() === code.toUpperCase()
  );
  if (coupon === undefined) {
    await interaction.editReply({ content: `No coupon found with code \`${code}\`.` });
    return;
  }

  await context.sellAuth.deleteCoupon(coupon.id);
  invalidateCouponCache();

  await interaction.editReply({
    content: `Coupon \`${coupon.code}\` (${discountLabel(coupon)}, ${usesLabel(coupon)}) was deleted.`
  });
}

export const couponCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('coupon')
    .setDescription('Manage discount coupons')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List all coupons with usage and savings')
        .addIntegerOption((option) =>
          option.setName('page').setDescription('Page number').setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Create a coupon that applies to all products')
        .addStringOption((option) =>
          option.setName('code').setDescription('The coupon code customers enter').setRequired(true).setMaxLength(64)
        )
        .addNumberOption((option) =>
          option
            .setName('discount')
            .setDescription('Discount amount (percent or fixed, depending on type)')
            .setRequired(true)
            .setMinValue(0.01)
            .setMaxValue(999999)
        )
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription('How the discount is applied')
            .setRequired(true)
            .addChoices(
              { name: 'Percentage (% off)', value: 'percentage' },
              { name: 'Fixed amount off', value: 'fixed' }
            )
        )
        .addIntegerOption((option) =>
          option.setName('max_uses').setDescription('Total number of times the coupon can be used').setMinValue(1)
        )
        .addIntegerOption((option) =>
          option.setName('max_uses_per_customer').setDescription('Uses allowed per customer').setMinValue(1)
        )
        .addNumberOption((option) =>
          option.setName('min_order').setDescription('Minimum order value required').setMinValue(0)
        )
        .addIntegerOption((option) =>
          option
            .setName('expires_in_days')
            .setDescription('Coupon expires this many days from now')
            .setMinValue(1)
            .setMaxValue(MAX_EXPIRY_DAYS)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('edit')
        .setDescription('Change a coupon without recreating it')
        .addStringOption((option) =>
          option
            .setName('code')
            .setDescription('The coupon to edit')
            .setRequired(true)
            .setMaxLength(64)
            .setAutocomplete(true)
        )
        .addNumberOption((option) =>
          option
            .setName('discount')
            .setDescription('New discount amount')
            .setMinValue(0.01)
            .setMaxValue(999999)
        )
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription('New discount type')
            .addChoices(
              { name: 'Percentage (% off)', value: 'percentage' },
              { name: 'Fixed amount off', value: 'fixed' }
            )
        )
        .addIntegerOption((option) =>
          option.setName('max_uses').setDescription('New total use limit').setMinValue(1)
        )
        .addIntegerOption((option) =>
          option.setName('max_uses_per_customer').setDescription('New per-customer limit').setMinValue(1)
        )
        .addNumberOption((option) =>
          option.setName('min_order').setDescription('New minimum order value').setMinValue(0)
        )
        .addIntegerOption((option) =>
          option
            .setName('expires_in_days')
            .setDescription('New expiry, this many days from now')
            .setMinValue(1)
            .setMaxValue(MAX_EXPIRY_DAYS)
        )
        .addBooleanOption((option) =>
          option.setName('clear_expiry').setDescription('Remove the expiry date entirely')
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('delete')
        .setDescription('Delete a coupon')
        .addStringOption((option) =>
          option
            .setName('code')
            .setDescription('The coupon code to delete')
            .setRequired(true)
            .setMaxLength(64)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const query = interaction.options.getFocused().toUpperCase();
    const coupons = await cachedCoupons(context);

    const matches = coupons
      .filter((coupon) => coupon.code.toUpperCase().includes(query))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((coupon) => ({
        name: truncate(`${coupon.code} \u00B7 ${discountLabel(coupon)} \u00B7 ${usesLabel(coupon)}`, MAX_CHOICE_NAME_LENGTH),
        value: coupon.code
      }));

    await interaction.respond(matches);
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
      case 'create':
        await handleCreate(interaction, context);
        return;
      case 'edit':
        await handleEdit(interaction, context);
        return;
      case 'delete':
        await handleDelete(interaction, context);
        return;
      default:
        await interaction.editReply({ content: 'Unknown subcommand.' });
    }
  }
};

function optionalInt(
  interaction: ChatInputCommandInteraction,
  optionName: string,
  key: 'maxUses' | 'maxUsesPerCustomer'
): Partial<CreateCouponInput> {
  const value = interaction.options.getInteger(optionName);
  return value === null ? {} : { [key]: value };
}

function optionalNumber(
  interaction: ChatInputCommandInteraction,
  optionName: string,
  key: 'minInvoicePrice'
): Partial<CreateCouponInput> {
  const value = interaction.options.getNumber(optionName);
  return value === null ? {} : { [key]: value };
}

function expirationDate(interaction: ChatInputCommandInteraction): Partial<CreateCouponInput> {
  const days = interaction.options.getInteger('expires_in_days');
  if (days === null) {
    return {};
  }
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return { expirationDate: date.toISOString().slice(0, 10) };
}
