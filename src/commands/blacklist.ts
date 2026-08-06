import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { formatCount, truncate } from '../lib/format.js';
import { SellAuthApiError } from '../sellauth/client.js';
import type { BlacklistEntry } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;
const MAX_REASON_LENGTH = 255;
const CACHE_TTL_MS = 60_000;
const CACHE_PAGE_SIZE = 100;
const ENTRIES_PER_PAGE = 15;
/** Autocomplete choice values carry the entry ID with this prefix, because
 * blacklisted values themselves can be fully numeric (Discord IDs, ASNs). */
const ID_PREFIX = 'id:';

const ENTRY_TYPES = [
  { name: 'Email', value: 'email' },
  { name: 'Email domain', value: 'email_domain' },
  { name: 'Discord ID', value: 'discord_id' },
  { name: 'IP address', value: 'ip' },
  { name: 'IP range', value: 'ip_range' },
  { name: 'Country code', value: 'country_code' },
  { name: 'City', value: 'city' },
  { name: 'ISP', value: 'isp' },
  { name: 'ASN', value: 'asn' },
  { name: 'User agent', value: 'user_agent' }
] as const;

interface BlacklistCache {
  readonly fetchedAt: number;
  readonly entries: readonly BlacklistEntry[];
}

let blacklistCache: BlacklistCache | null = null;

async function cachedEntries(context: CommandContext): Promise<readonly BlacklistEntry[]> {
  const now = Date.now();
  if (blacklistCache !== null && now - blacklistCache.fetchedAt < CACHE_TTL_MS) {
    return blacklistCache.entries;
  }
  const firstPage = await context.sellAuth.getBlacklist(1, CACHE_PAGE_SIZE);
  blacklistCache = { fetchedAt: now, entries: firstPage.data };
  return firstPage.data;
}

function invalidateBlacklistCache(): void {
  blacklistCache = null;
}

function entryLine(entry: BlacklistEntry): string {
  const parts = [`\`${entry.value}\``, entry.type];
  if (entry.reason !== null && entry.reason !== '') {
    parts.push(truncate(entry.reason, 60));
  }
  parts.push(time(new Date(entry.created_at), TimestampStyles.ShortDate));
  if (!entry.enabled) {
    parts.push('**disabled**');
  }
  return parts.join(' \u00B7 ');
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const page = interaction.options.getInteger('page') ?? 1;
  const entries = await context.sellAuth.getBlacklist(page, ENTRIES_PER_PAGE);
  const lastPage = Math.max(entries.last_page, 1);

  if (entries.data.length === 0) {
    await interaction.editReply({
      content:
        entries.total === 0 ? 'The blacklist is empty.' : `Page ${page} is empty (last page is ${lastPage}).`
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Blacklist (${formatCount(entries.total)})`)
    .setDescription(entries.data.map(entryLine).join('\n'))
    .setFooter({ text: `Page ${entries.current_page}/${lastPage}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const type = interaction.options.getString('type', true);
  const value = interaction.options.getString('value', true).trim();
  const reason = interaction.options.getString('reason')?.trim();

  if (value === '') {
    await interaction.editReply({ content: 'The value cannot be empty.' });
    return;
  }

  const existing = await context.sellAuth.getBlacklist(1, CACHE_PAGE_SIZE, value);
  const duplicate = existing.data.find(
    (entry) => entry.type === type && entry.value.toLowerCase() === value.toLowerCase()
  );
  if (duplicate !== undefined) {
    await interaction.editReply({
      content: `\`${duplicate.value}\` is already blacklisted as ${duplicate.type}.`
    });
    return;
  }

  try {
    await context.sellAuth.createBlacklistEntry(
      reason === undefined || reason === '' ? { value, type } : { value, type, reason }
    );
  } catch (error) {
    if (error instanceof SellAuthApiError) {
      const detail = error.apiMessage ?? `the SellAuth API responded with HTTP ${error.status}`;
      await interaction.editReply({ content: `Could not add the entry: ${detail}` });
      return;
    }
    throw error;
  }
  invalidateBlacklistCache();

  const reasonSuffix = reason === undefined || reason === '' ? '' : ` (reason: ${reason})`;
  await interaction.editReply({
    content: `\`${value}\` was added to the blacklist as ${type}${reasonSuffix}.`
  });
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const input = interaction.options.getString('value', true).trim();

  let entry: BlacklistEntry | undefined;
  if (input.startsWith(ID_PREFIX)) {
    const id = Number(input.slice(ID_PREFIX.length));
    entry = (await cachedEntries(context)).find((candidate) => candidate.id === id);
  } else {
    const matches = (await context.sellAuth.getBlacklist(1, CACHE_PAGE_SIZE, input)).data.filter(
      (candidate) => candidate.value.toLowerCase() === input.toLowerCase()
    );
    if (matches.length > 1) {
      await interaction.editReply({
        content: `\`${input}\` is blacklisted under multiple types (${matches.map((match) => match.type).join(', ')}). Pick the exact entry from the autocomplete suggestions.`
      });
      return;
    }
    entry = matches[0];
  }

  if (entry === undefined) {
    await interaction.editReply({ content: `No blacklist entry found for \`${input}\`.` });
    return;
  }

  await context.sellAuth.deleteBlacklistEntry(entry.id);
  invalidateBlacklistCache();

  await interaction.editReply({
    content: `\`${entry.value}\` (${entry.type}) was removed from the blacklist.`
  });
}

async function handleCheck(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const value = interaction.options.getString('value', true).trim();
  const matches = (await context.sellAuth.getBlacklist(1, CACHE_PAGE_SIZE, value)).data;

  if (matches.length === 0) {
    await interaction.editReply({ content: `\`${value}\` is not on the blacklist.` });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Blacklist matches for "${truncate(value, 100)}"`)
    .setDescription(matches.map(entryLine).join('\n'))
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export const blacklistCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Manage who is blocked from buying in your shop')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List blacklist entries')
        .addIntegerOption((option) =>
          option.setName('page').setDescription('Page number').setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add an entry to the blacklist')
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription('What kind of value this is')
            .setRequired(true)
            .addChoices(...ENTRY_TYPES)
        )
        .addStringOption((option) =>
          option
            .setName('value')
            .setDescription('The email, IP, Discord ID, etc. to block')
            .setRequired(true)
            .setMaxLength(255)
        )
        .addStringOption((option) =>
          option
            .setName('reason')
            .setDescription('Why this entry is blocked (shown in the dashboard)')
            .setMaxLength(MAX_REASON_LENGTH)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove an entry from the blacklist')
        .addStringOption((option) =>
          option
            .setName('value')
            .setDescription('The blacklisted value to remove')
            .setRequired(true)
            .setMaxLength(255)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('check')
        .setDescription('Check whether a value is blacklisted and why')
        .addStringOption((option) =>
          option
            .setName('value')
            .setDescription('The email, IP, Discord ID, etc. to check')
            .setRequired(true)
            .setMaxLength(255)
        )
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const query = interaction.options.getFocused().toLowerCase();
    const entries = await cachedEntries(context);

    const matches = entries
      .filter((entry) => entry.value.toLowerCase().includes(query))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((entry) => ({
        name: truncate(`${entry.value} \u00B7 ${entry.type}`, MAX_CHOICE_NAME_LENGTH),
        value: `${ID_PREFIX}${entry.id}`
      }));

    await interaction.respond(matches);
  },

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    switch (interaction.options.getSubcommand()) {
      case 'list':
        await handleList(interaction, context);
        return;
      case 'add':
        await handleAdd(interaction, context);
        return;
      case 'remove':
        await handleRemove(interaction, context);
        return;
      case 'check':
        await handleCheck(interaction, context);
        return;
      default:
        await interaction.editReply({ content: 'Unknown subcommand.' });
    }
  }
};
