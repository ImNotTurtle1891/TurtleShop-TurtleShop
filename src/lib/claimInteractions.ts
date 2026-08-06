import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction
} from 'discord.js';
import type { CommandContext } from '../commands/types.js';
import { claimOrder } from './orderClaims.js';

export const CLAIM_ORDER_BUTTON_ID = 'sellbot:claim-order';
export const CLAIM_ORDER_MODAL_ID = 'sellbot:claim-order-modal';
const ORDER_ID_INPUT_ID = 'order-id';

export async function openClaimOrderModal(interaction: ButtonInteraction): Promise<void> {
  const orderIdInput = new TextInputBuilder()
    .setCustomId(ORDER_ID_INPUT_ID)
    .setLabel('Your order ID')
    .setPlaceholder('Found in your order confirmation email')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(64);

  const modal = new ModalBuilder()
    .setCustomId(CLAIM_ORDER_MODAL_ID)
    .setTitle('Claim Your Order')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(orderIdInput));

  await interaction.showModal(modal);
}

export async function handleClaimOrderModal(
  interaction: ModalSubmitInteraction,
  context: CommandContext
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const orderId = interaction.fields.getTextInputValue(ORDER_ID_INPUT_ID);
  const result = await claimOrder(orderId, interaction.member, context);
  await interaction.editReply({ content: result.message });
}
