import type { ChatInputCommandInteraction } from 'discord.js';
import { SellAuthApiError } from '../sellauth/client.js';

/**
 * Replies with the SellAuth API's own error message ("Could not <actionLabel>: ...").
 * Rethrows anything that is not a SellAuthApiError.
 */
export async function replyWithApiError(
  interaction: ChatInputCommandInteraction,
  error: unknown,
  actionLabel: string
): Promise<void> {
  if (!(error instanceof SellAuthApiError)) {
    throw error;
  }
  const reason = error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`;
  await interaction.editReply({ content: `Could not ${actionLabel}: ${reason}` });
}
