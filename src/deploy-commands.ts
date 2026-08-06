import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';
import { loadConfig } from './config.js';

const config = loadConfig();

const rest = new REST().setToken(config.discordToken);
const body = commands.map((command) => command.data.toJSON());

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
