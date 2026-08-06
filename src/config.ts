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

const REQUIRED_ENV_VARS = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'SELLAUTH_API_KEY',
  'SELLAUTH_SHOP_ID'
] as const;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function loadConfig(): BotConfig {
  const missing = REQUIRED_ENV_VARS.filter((name) => readEnv(name) === undefined);
  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    for (const name of missing) {
      console.error(`  - ${name}`);
    }
    console.error('Copy .env.example to .env, fill in the values, and try again.');
    process.exit(1);
  }

  return {
    discordToken: readEnv('DISCORD_TOKEN') ?? '',
    discordClientId: readEnv('DISCORD_CLIENT_ID') ?? '',
    discordGuildId: readEnv('DISCORD_GUILD_ID'),
    sellAuthApiKey: readEnv('SELLAUTH_API_KEY') ?? '',
    sellAuthShopId: readEnv('SELLAUTH_SHOP_ID') ?? '',
    sellAuthBaseUrl: normalizeBaseUrl(readEnv('SELLAUTH_BASE_URL') ?? DEFAULT_BASE_URL)
  };
}
