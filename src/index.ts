import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client as ReadyDiscordClient
} from 'discord.js';
import { loadBotConfig } from './botConfig.js';
import { commands } from './commands/index.js';
import type { Command, CommandContext } from './commands/types.js';
import { loadConfig } from './config.js';
import { evaluateAccess } from './lib/permissions.js';
import { SellAuthApiError, SellAuthClient } from './sellauth/client.js';

const config = loadConfig();
const botConfig = loadBotConfig();

const sellAuth = new SellAuthClient({
  apiKey: config.sellAuthApiKey,
  shopId: config.sellAuthShopId,
  baseUrl: config.sellAuthBaseUrl
});

const context: CommandContext = { sellAuth };

const commandsByName = new Map<string, Command>(
  commands.map((command) => [command.data.name, command])
);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function userFacingErrorMessage(error: unknown): string {
  if (error instanceof SellAuthApiError) {
    if (error.status === 401 || error.status === 403) {
      return 'SellAuth rejected the API key. Check SELLAUTH_API_KEY and SELLAUTH_SHOP_ID.';
    }
    if (error.status === 429) {
      return 'SellAuth is rate limiting the bot. Try again in a moment.';
    }
    return 'The SellAuth API returned an error. Try again later.';
  }
  return 'Something went wrong while running this command.';
}

async function replyWithError(
  interaction: ChatInputCommandInteraction,
  error: unknown
): Promise<void> {
  const content = userFacingErrorMessage(error);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

const STATUS_MESSAGES = ['Made for sellauth.com', 'Made by barkiedev.cc'] as const;
const STATUS_ROTATION_MS = 30_000;

function startStatusRotation(readyClient: ReadyDiscordClient<true>): void {
  let statusIndex = 0;

  const applyStatus = (): void => {
    const message = STATUS_MESSAGES[statusIndex % STATUS_MESSAGES.length];
    if (message !== undefined) {
      readyClient.user.setActivity(message, { type: ActivityType.Watching });
    }
    statusIndex += 1;
  };

  applyStatus();
  setInterval(applyStatus, STATUS_ROTATION_MS);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`SellBot is online as ${readyClient.user.tag}`);
  startStatusRotation(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = commandsByName.get(interaction.commandName);
  if (command === undefined) {
    return;
  }

  const access = evaluateAccess(interaction, botConfig);
  if (!access.allowed) {
    await interaction.reply({ content: access.reason, flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    await command.execute(interaction, context);
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed:`, error);
    try {
      await replyWithError(interaction, error);
    } catch (replyError) {
      console.error('Failed to send error response:', replyError);
    }
  }
});

void client.login(config.discordToken);
