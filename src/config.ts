import { config as loadEnv } from 'dotenv';

// .env.local wins over .env because dotenv never overwrites existing values.
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const DEFAULT_BASE_URL = 'https://api.sellauth.com/v1';

export interface BotConfig {
  readonly discordToken: string;
  readonly discordClientId: string;
  /** When set, slash commands register to this guild only (instant, ideal for development). */
  readonly discordGuildId: string | undefined;
  readonly sellAuthApiKey: string;
  readonly sellAuthShopId: string;
  readonly sellAuthBaseUrl: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    console.error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`
    );
    process.exit(1);
  }
  return value.trim();
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function loadConfig(): BotConfig {
  const guildId = process.env['DISCORD_GUILD_ID']?.trim();

  return {
    discordToken: requireEnv('DISCORD_TOKEN'),
    discordClientId: requireEnv('DISCORD_CLIENT_ID'),
    discordGuildId: guildId === undefined || guildId === '' ? undefined : guildId,
    sellAuthApiKey: requireEnv('SELLAUTH_API_KEY'),
    sellAuthShopId: requireEnv('SELLAUTH_SHOP_ID'),
    sellAuthBaseUrl: normalizeBaseUrl(process.env['SELLAUTH_BASE_URL'] ?? DEFAULT_BASE_URL)
  };
}
