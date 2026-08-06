import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandBuilder
} from 'discord.js';
import { formatCount, truncate } from '../lib/format.js';
import { SellAuthApiError } from '../sellauth/client.js';
import type { TicketDetail, TicketListItem, TicketMessage } from '../sellauth/types.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

const TICKETS_PER_PAGE = 10;
const MAX_MESSAGES_SHOWN = 10;
const MAX_MESSAGE_PREVIEW = 200;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;
const CACHE_TTL_MS = 30_000;
const CACHE_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TicketCache {
  readonly fetchedAt: number;
  readonly tickets: readonly TicketListItem[];
}

let ticketCache: TicketCache | null = null;

async function cachedTickets(context: CommandContext): Promise<readonly TicketListItem[]> {
  const now = Date.now();
  if (ticketCache !== null && now - ticketCache.fetchedAt < CACHE_TTL_MS) {
    return ticketCache.tickets;
  }
  const firstPage = await context.sellAuth.getTickets({ page: 1, perPage: CACHE_PAGE_SIZE });
  ticketCache = { fetchedAt: now, tickets: firstPage.data };
  return firstPage.data;
}

function invalidateTicketCache(): void {
  ticketCache = null;
}

function senderLabel(message: TicketMessage, ticket: TicketListItem): string {
  if (message.sender_type === 'shop_customer') {
    return message.sender?.email ?? ticket.customer?.email ?? 'Customer';
  }
  return 'Shop';
}

function ticketLine(ticket: TicketListItem): string {
  const parts = [
    ticket.status === 'open' ? '\u{1F7E2}' : '\u26AA',
    `**${truncate(ticket.subject, 45)}**`,
    ticket.customer?.email ?? 'unknown'
  ];
  const preview = ticket.last_message?.content;
  if (preview !== undefined && preview !== '') {
    parts.push(`"${truncate(preview, 40)}"`);
  }
  parts.push(time(new Date(ticket.created_at), TimestampStyles.ShortDate));
  return `${parts.join(' \u00B7 ')}\n\u2514 \`${ticket.id}\``;
}

async function resolveTicket(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<TicketDetail | null> {
  const id = interaction.options.getString('id', true).trim();
  if (!UUID_PATTERN.test(id)) {
    await interaction.editReply({
      content: 'That does not look like a ticket ID. Pick one from the autocomplete suggestions or copy it from `/ticket list`.'
    });
    return null;
  }
  try {
    return await context.sellAuth.getTicket(id);
  } catch (error) {
    if (error instanceof SellAuthApiError && error.status === 404) {
      await interaction.editReply({ content: `No ticket found with ID \`${id}\`.` });
      return null;
    }
    throw error;
  }
}

function ticketEmbed(ticket: TicketDetail): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ticket.status === 'open' ? 0x57f287 : EMBED_COLOR)
    .setTitle(truncate(ticket.subject, 250))
    .addFields(
      { name: 'Status', value: ticket.status, inline: true },
      { name: 'Customer', value: ticket.customer?.email ?? 'unknown', inline: true },
      {
        name: 'Created',
        value: time(new Date(ticket.created_at), TimestampStyles.ShortDateTime),
        inline: true
      }
    )
    .setFooter({ text: `Ticket ${ticket.id}` })
    .setTimestamp();

  if (ticket.invoice !== null) {
    embed.addFields({ name: 'Invoice', value: `\`${ticket.invoice.unique_id}\``, inline: true });
  }

  const recent = ticket.messages.slice(-MAX_MESSAGES_SHOWN);
  const lines = recent.map((message) => {
    const timestamp = time(new Date(message.created_at), TimestampStyles.ShortDate);
    return `**${senderLabel(message, ticket)}** (${timestamp}): ${truncate(message.content, MAX_MESSAGE_PREVIEW)}`;
  });
  const skipped = ticket.messages.length - recent.length;
  embed.setDescription(
    `${skipped > 0 ? `*\u2026 ${skipped} earlier message(s) not shown*\n` : ''}${lines.length > 0 ? lines.join('\n\n') : 'No messages yet.'}`
  );

  return embed;
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const page = interaction.options.getInteger('page') ?? 1;
  const status = interaction.options.getString('status');
  const email = interaction.options.getString('email')?.trim().toLowerCase();

  const tickets = await context.sellAuth.getTickets({
    page,
    perPage: TICKETS_PER_PAGE,
    ...(status === null ? {} : { status }),
    ...(email === undefined || email === '' ? {} : { email })
  });
  const lastPage = Math.max(tickets.last_page, 1);

  if (tickets.data.length === 0) {
    await interaction.editReply({
      content:
        tickets.total === 0
          ? 'No tickets match those filters.'
          : `Page ${page} is empty (last page is ${lastPage}).`
    });
    return;
  }

  const filters = [
    ...(status === null ? [] : [status]),
    ...(email === undefined || email === '' ? [] : [email])
  ];
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Tickets (${formatCount(tickets.total)})${filters.length > 0 ? ` \u2014 ${filters.join(', ')}` : ''}`)
    .setDescription(tickets.data.map(ticketLine).join('\n'))
    .setFooter({ text: `Page ${tickets.current_page}/${lastPage} \u00B7 View one with /ticket view` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleReply(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const ticket = await resolveTicket(interaction, context);
  if (ticket === null) {
    return;
  }
  const message = interaction.options.getString('message', true).trim();

  await context.sellAuth.sendTicketMessage(ticket.id, message);
  invalidateTicketCache();

  await interaction.editReply({
    content: `Reply sent on **${truncate(ticket.subject, 100)}** (${ticket.customer?.email ?? 'unknown'}):\n> ${truncate(message, 500)}`
  });
}

async function handleCloseReopen(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  action: 'close' | 'reopen'
): Promise<void> {
  const ticket = await resolveTicket(interaction, context);
  if (ticket === null) {
    return;
  }

  if (action === 'close' && ticket.status !== 'open') {
    await interaction.editReply({ content: `**${truncate(ticket.subject, 100)}** is already closed.` });
    return;
  }
  if (action === 'reopen' && ticket.status === 'open') {
    await interaction.editReply({ content: `**${truncate(ticket.subject, 100)}** is already open.` });
    return;
  }

  if (action === 'close') {
    await context.sellAuth.closeTicket(ticket.id);
  } else {
    await context.sellAuth.reopenTicket(ticket.id);
  }
  invalidateTicketCache();

  await interaction.editReply({
    content: `Ticket **${truncate(ticket.subject, 100)}** (${ticket.customer?.email ?? 'unknown'}) was ${action === 'close' ? 'closed' : 'reopened'}.`
  });
}

async function handleArchive(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
  action: 'archive' | 'unarchive'
): Promise<void> {
  const ticket = await resolveTicket(interaction, context);
  if (ticket === null) {
    return;
  }

  if (action === 'archive') {
    await context.sellAuth.archiveTicket(ticket.id);
  } else {
    await context.sellAuth.unarchiveTicket(ticket.id);
  }
  invalidateTicketCache();

  await interaction.editReply({
    content: `Ticket **${truncate(ticket.subject, 100)}** (${ticket.customer?.email ?? 'unknown'}) was ${action === 'archive' ? 'archived' : 'unarchived'}.`
  });
}

function addIdOption(name: string): (subcommand: SlashCommandSubcommandBuilder) => SlashCommandSubcommandBuilder {
  return (subcommand) =>
    subcommand.addStringOption((option) =>
      option
        .setName('id')
        .setDescription(`The ticket to ${name}`)
        .setRequired(true)
        .setAutocomplete(true)
    );
}

export const ticketCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('View and manage support tickets')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List tickets, newest first')
        .addStringOption((option) =>
          option
            .setName('status')
            .setDescription('Only tickets with this status')
            .addChoices({ name: 'Open', value: 'open' }, { name: 'Closed', value: 'closed' })
        )
        .addStringOption((option) =>
          option.setName('email').setDescription('Only tickets from this customer').setMaxLength(254)
        )
        .addIntegerOption((option) =>
          option.setName('page').setDescription('Page number').setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      addIdOption('view')(
        subcommand.setName('view').setDescription('A ticket with its recent messages')
      )
    )
    .addSubcommand((subcommand) =>
      addIdOption('reply to')(
        subcommand.setName('reply').setDescription('Send a message to a ticket')
      ).addStringOption((option) =>
        option
          .setName('message')
          .setDescription('Your message to the customer')
          .setRequired(true)
          .setMaxLength(2000)
      )
    )
    .addSubcommand((subcommand) =>
      addIdOption('close')(subcommand.setName('close').setDescription('Close a ticket'))
    )
    .addSubcommand((subcommand) =>
      addIdOption('reopen')(subcommand.setName('reopen').setDescription('Reopen a closed ticket'))
    )
    .addSubcommand((subcommand) =>
      addIdOption('archive')(
        subcommand.setName('archive').setDescription('Archive a ticket (hides it from the default list)')
      )
    )
    .addSubcommand((subcommand) =>
      addIdOption('unarchive')(
        subcommand.setName('unarchive').setDescription('Bring a ticket back from the archive')
      )
    ),

  async autocomplete(
    interaction: AutocompleteInteraction,
    context: CommandContext
  ): Promise<void> {
    const query = interaction.options.getFocused().toLowerCase();
    const tickets = await cachedTickets(context);

    const matches = tickets
      .filter((ticket) =>
        `${ticket.subject} ${ticket.customer?.email ?? ''}`.toLowerCase().includes(query)
      )
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((ticket) => ({
        name: truncate(
          `${ticket.status === 'open' ? '[open]' : '[closed]'} ${ticket.subject} \u00B7 ${ticket.customer?.email ?? 'unknown'}`,
          MAX_CHOICE_NAME_LENGTH
        ),
        value: ticket.id
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
      case 'view': {
        const ticket = await resolveTicket(interaction, context);
        if (ticket !== null) {
          await interaction.editReply({ embeds: [ticketEmbed(ticket)] });
        }
        return;
      }
      case 'reply':
        await handleReply(interaction, context);
        return;
      case 'close':
        await handleCloseReopen(interaction, context, 'close');
        return;
      case 'reopen':
        await handleCloseReopen(interaction, context, 'reopen');
        return;
      case 'archive':
        await handleArchive(interaction, context, 'archive');
        return;
      case 'unarchive':
        await handleArchive(interaction, context, 'unarchive');
        return;
      default:
        await interaction.editReply({ content: 'Unknown subcommand.' });
    }
  }
};
