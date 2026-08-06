import { PermissionFlagsBits, REST, Routes } from 'discord.js';
import {
  loadBotConfig,
  permissionLevelsForCommand,
  rolesForLevel,
  type PermissionLevel
} from './botConfig.js';
import { commands } from './commands/index.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const botConfig = loadBotConfig();

function isVisibleWithoutManageGuild(level: PermissionLevel): boolean {
  return level === 'everyone' || rolesForLevel(botConfig, level).length > 0;
}

/**
 * Decides which members see a command by default. Discord visibility applies
 * to the whole command, so the most permissive level among the command and
 * its subcommand overrides wins; SellBot enforces the exact levels at runtime.
 */
function defaultMemberPermissions(commandName: string): bigint | null {
  const levels = permissionLevelsForCommand(botConfig, commandName);
  return levels.some(isVisibleWithoutManageGuild) ? null : PermissionFlagsBits.ManageGuild;
}

const unconfiguredCommands = commands
  .map((command) => command.data.name)
  .filter((name) => botConfig.commandPermissions[name] === undefined);
if (unconfiguredCommands.length > 0) {
  console.warn(
    `Warning: no commandPermissions entry in config.json for: ${unconfiguredCommands.join(', ')}. ` +
      'These commands default to the "admin" level.'
  );
}

const rest = new REST().setToken(config.discordToken);
const body = commands.map((command) =>
  command.data.setDefaultMemberPermissions(defaultMemberPermissions(command.data.name)).toJSON()
);

try {
  if (config.discordGuildId === undefined) {
    await rest.put(Routes.applicationCommands(config.discordClientId), { body });
    console.log(`Registered ${body.length} slash commands globally.`);
    console.log('Note: global commands can take up to an hour to appear in Discord.');
  } else {
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
      { body }
    );
    console.log(
      `Registered ${body.length} slash commands to guild ${config.discordGuildId} (available immediately).`
    );
  }
} catch (error) {
  console.error('Failed to register slash commands:', error);
  process.exit(1);
}
