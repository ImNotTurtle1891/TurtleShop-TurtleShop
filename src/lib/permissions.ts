import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { permissionLevelFor, rolesForLevel, type SellBotConfig } from '../botConfig.js';

export type AccessDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const ALLOWED: AccessDecision = { allowed: true };

function checkChannel(
  interaction: ChatInputCommandInteraction<'cached'>,
  config: SellBotConfig
): AccessDecision {
  if (config.allowedChannelIds.length === 0) {
    return ALLOWED;
  }

  const parentId = interaction.channel?.parentId ?? null;
  const inAllowedChannel =
    config.allowedChannelIds.includes(interaction.channelId) ||
    (parentId !== null && config.allowedChannelIds.includes(parentId));

  return inAllowedChannel
    ? ALLOWED
    : { allowed: false, reason: 'SellBot commands are not enabled in this channel.' };
}

export function evaluateAccess(
  interaction: ChatInputCommandInteraction,
  config: SellBotConfig
): AccessDecision {
  if (!interaction.inCachedGuild()) {
    return { allowed: false, reason: 'SellBot commands can only be used in a server.' };
  }

  const channelDecision = checkChannel(interaction, config);
  if (!channelDecision.allowed) {
    return channelDecision;
  }

  const subcommand = interaction.options.getSubcommand(false);
  const level = permissionLevelFor(config, interaction.commandName, subcommand);
  if (level === 'everyone') {
    return ALLOWED;
  }

  // Server administrators always have access, so the owner is never locked out.
  if (interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return ALLOWED;
  }

  const allowedRoleIds = rolesForLevel(config, level);
  if (allowedRoleIds.length === 0) {
    return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
      ? ALLOWED
      : {
          allowed: false,
          reason: 'You need the Manage Server permission to use this command.'
        };
  }

  return interaction.member.roles.cache.hasAny(...allowedRoleIds)
    ? ALLOWED
    : {
        allowed: false,
        reason: `You need ${level === 'admin' ? 'an admin' : 'a support or admin'} role to use this command.`
      };
}
