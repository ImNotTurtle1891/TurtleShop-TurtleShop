import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from 'discord.js';
import { replyWithApiError } from '../lib/apiErrors.js';
import { formatCount, truncate } from '../lib/format.js';
import type { WhitelistEntry } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;
const MAX_REASON_LENGTH = 255;
const CACHE_TTL_MS = 60_000;
const CACHE_PAGE_SIZE = 100;
const ENTRIES_PER_PAGE = 15;
/** Autocomplete values carry the entry ID, since whitelisted values can be fully numeric. */
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

interface WhitelistCache {
  readonly fetchedAt: number;
  readonly entries: readonly WhitelistEntry[];
}

let whitelistCache: WhitelistCache | null = null;

async function cachedEntries(context: CommandContext): Promise<readonly WhitelistEntry[]> {
  const now = Date.now();
  if (whitelistCache !== null && now - whitelistCache.fetchedAt < CACHE_TTL_MS) {
    return whitelistCache.entries;
  }
  const firstPage = await context.sellAuth.getWhitelist(1, CACHE_PAGE_SIZE);
  whitelistCache = { fetchedAt: now, entries: firstPage.data };
  return firstPage.data;
}

function invalidateWhitelistCache(): void {
  whitelistCache = null;
}

function entryLine(entry: WhitelistEntry): string {
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
  const entries = await context.sellAuth.getWhitelist(page, ENTRIES_PER_PAGE);
  const lastPage = Math.max(entries.last_page, 1);

  if (entries.data.length === 0) {
    await interaction.editReply({
      content:
        entries.total === 0 ? 'The whitelist is empty.' : `Page ${page} is empty (last page is ${lastPage}).`
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Whitelist (${formatCount(entries.total)})`)
    .setDescription(entries.data.map(entryLine).join('\n'))
    .setFooter({ text: `Page ${entries.current_page}/${lastPage} \u00B7 Whitelist entries override blacklist rules` })
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

  const existing = await context.sellAuth.getWhitelist(1, CACHE_PAGE_SIZE, value);
  const duplicate = existing.data.find(
    (entry) => entry.type === type && entry.value.toLowerCase() === value.toLowerCase()
  );
  if (duplicate !== undefined) {
    await interaction.editReply({
      content: `\`${duplicate.value}\` is already whitelisted as ${duplicate.type}.`
    });
    return;
  }

  try {
    await context.sellAuth.createWhitelistEntry(
      reason === undefined || reason === '' ? { value, type } : { value, type, reason }
    );
  } catch (error) {
    await replyWithApiError(interaction, error, 'add the whitelist entry');
    return;
  }
  invalidateWhitelistCache();

  const reasonSuffix = reason === undefined || reason === '' ? '' : ` (reason: ${reason})`;
  await interaction.editReply({
    content: `\`${value}\` was whitelisted as ${type}${reasonSuffix}. It now overrides matching blacklist rules.`
  });
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const input = interaction.options.getString('value', true).trim();

  let entry: WhitelistEntry | undefined;
  if (input.startsWith(ID_PREFIX)) {
    const id = Number(input.slice(ID_PREFIX.length));
    entry = (await cachedEntries(context)).find((candidate) => candidate.id === id);
  } else {
    const matches = (await context.sellAuth.getWhitelist(1, CACHE_PAGE_SIZE, input)).data.filter(
      (candidate) => candidate.value.toLowerCase() === input.toLowerCase()
    );
    if (matches.length > 1) {
      await interaction.editReply({
        content: `\`${input}\` is whitelisted under multiple types (${matches.map((match) => match.type).join(', ')}). Pick the exact entry from the autocomplete suggestions.`
      });
      return;
    }
    entry = matches[0];
  }

  if (entry === undefined) {
    await interaction.editReply({ content: `No whitelist entry found for \`${input}\`.` });
    return;
  }

  await context.sellAuth.deleteWhitelistEntry(entry.id);
  invalidateWhitelistCache();

  await interaction.editReply({
    content: `\`${entry.value}\` (${entry.type}) was removed from the whitelist.`
  });
}

export const whitelistCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Manage exceptions that override your blacklist rules')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List whitelist entries')
        .addIntegerOption((option) =>
          option.setName('page').setDescription('Page number').setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add an entry to the whitelist')
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
            .setDescription('The email, IP, Discord ID, etc. to allow')
            .setRequired(true)
            .setMaxLength(255)
        )
        .addStringOption((option) =>
          option
            .setName('reason')
            .setDescription('Why this entry is allowed (shown in the dashboard)')
            .setMaxLength(MAX_REASON_LENGTH)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove an entry from the whitelist')
        .addStringOption((option) =>
          option
            .setName('value')
            .setDescription('The whitelisted value to remove')
            .setRequired(true)
            .setMaxLength(255)
            .setAutocomplete(true)
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
      default:
        await interaction.editReply({ content: 'Unknown subcommand.' });
    }
  }
};
