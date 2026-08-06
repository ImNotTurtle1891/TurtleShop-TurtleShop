import type {
  ChatInputCommandInteraction,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';
import type { SellAuthClient } from '../sellauth/client.js';

export interface CommandContext {
  readonly sellAuth: SellAuthClient;
}

export interface Command {
  readonly data: SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
}

export const EMBED_COLOR = 0x00b67a as const;
