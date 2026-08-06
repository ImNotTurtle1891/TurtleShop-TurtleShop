import type { GuildMember } from 'discord.js';
import type { CommandContext } from '../commands/types.js';
import { SellAuthApiError } from '../sellauth/client.js';
import type { Invoice } from '../sellauth/types.js';
import { getClaim, recordClaim } from './claimStore.js';

const CLAIMABLE_STATUSES: readonly string[] = ['completed', 'partially_completed'];
const ORDER_ID_PATTERN = /^[\w-]{1,64}$/;

export interface ClaimResult {
  readonly ok: boolean;
  readonly message: string;
}

function successMessage(invoice: Invoice): string {
  const productNames = invoice.items
    .map((item) => item.product?.name)
    .filter((name): name is string => typeof name === 'string');
  const productInfo = productNames.length > 0 ? ` for **${productNames.join(', ')}**` : '';
  return `Order verified${productInfo}! You have been given the customer role. Thank you for your purchase!`;
}

export async function claimOrder(
  rawOrderId: string,
  member: GuildMember,
  context: CommandContext
): Promise<ClaimResult> {
  const orderId = rawOrderId.trim();
  if (!ORDER_ID_PATTERN.test(orderId)) {
    return { ok: false, message: 'That does not look like a valid order ID.' };
  }

  const customerRoleId = context.botConfig.customerRoleId;
  if (customerRoleId === null) {
    return {
      ok: false,
      message:
        'Order claiming is not set up on this server yet (customerRoleId is missing in config.json). Please contact an admin.'
    };
  }

  let invoice: Invoice;
  try {
    invoice = await context.sellAuth.getInvoice(orderId);
  } catch (error) {
    if (error instanceof SellAuthApiError && error.status === 404) {
      return { ok: false, message: `No order found with ID \`${orderId}\`. Double-check your order confirmation.` };
    }
    throw error;
  }

  if (!CLAIMABLE_STATUSES.includes(invoice.status)) {
    return {
      ok: false,
      message: 'This order has not been completed, so it cannot be claimed. If you just paid, try again in a few minutes.'
    };
  }

  const claimKey = String(invoice.id);
  const existingClaim = getClaim(claimKey);
  if (existingClaim !== undefined && existingClaim.discordUserId !== member.id) {
    return { ok: false, message: 'This order has already been claimed by another user.' };
  }

  try {
    await member.roles.add(customerRoleId);
  } catch (error) {
    console.error(`Failed to assign customer role ${customerRoleId} to ${member.id}:`, error);
    return {
      ok: false,
      message:
        'Your order is valid, but the customer role could not be assigned. Please contact an admin (the bot may be missing the Manage Roles permission).'
    };
  }

  if (existingClaim === undefined) {
    recordClaim(claimKey, {
      discordUserId: member.id,
      claimedAt: new Date().toISOString()
    });
  }

  return { ok: true, message: successMessage(invoice) };
}
