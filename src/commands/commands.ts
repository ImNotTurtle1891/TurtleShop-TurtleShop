import {
  ApplicationCommandOptionType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { permissionLevelFor, type SellBotConfig } from '../botConfig.js';
import { EMBED_COLOR, type Command, type CommandContext } from './types.js';

function commandLines(allCommands: readonly Command[], config: SellBotConfig): string[] {
  const lines: string[] = [];
  for (const command of allCommands) {
    const definition = command.data.toJSON();
    const subcommands = (definition.options ?? []).filter(
      (option) => option.type === ApplicationCommandOptionType.Subcommand
    );

    if (subcommands.length === 0) {
      const level = permissionLevelFor(config, definition.name);
      lines.push(`**/${definition.name}** \u2014 ${definition.description} \`${level}\``);
      continue;
    }

    for (const subcommand of subcommands) {
      const level = permissionLevelFor(config, definition.name, subcommand.name);
      lines.push(
        `**/${definition.name} ${subcommand.name}** \u2014 ${subcommand.description} \`${level}\``
      );
    }
  }
  return lines;
}

export const commandsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('commands')
    .setDescription('List all SellBot commands and who can use them'),

  async execute(
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ): Promise<void> {
    // Imported lazily to avoid a circular dependency with the command registry.
    const { commands } = await import('./index.js');

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('SellBot Commands')
      .setDescription(commandLines(commands, context.botConfig).join('\n'))
      .setFooter({ text: 'The tag behind each command is the required permission level' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
