import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';
import type { SellBotConfig } from '../botConfig.js';
import type { SellAuthClient } from '../sellauth/client.js';

export interface CommandContext {
  readonly sellAuth: SellAuthClient;
  readonly botConfig: SellBotConfig;
}

export interface Command {
  readonly data: SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, context: CommandContext): Promise<void>;
}

export const EMBED_COLOR = 0x00b67a as const;
