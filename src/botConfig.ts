import { existsSync, readFileSync } from 'node:fs';

const CONFIG_FILE = 'config.json';

export const PERMISSION_LEVELS = ['admin', 'support', 'everyone'] as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export interface RoleConfig {
  /** Role IDs that grant access to admin-level commands. */
  readonly adminRoleIds: readonly string[];
  /** Role IDs that grant access to support-level commands. Admin roles are always included. */
  readonly supportRoleIds: readonly string[];
}

export interface SellBotConfig {
  readonly roles: RoleConfig;
  /** Permission level per command name. Commands not listed default to "admin". */
  readonly commandPermissions: Readonly<Record<string, PermissionLevel>>;
  /**
   * Channel or category IDs where commands may be used.
   * Empty means commands work everywhere.
   */
  readonly allowedChannelIds: readonly string[];
  /** Role granted to members who claim a completed order. Null disables claiming. */
  readonly customerRoleId: string | null;
}

const DEFAULT_CONFIG: SellBotConfig = {
  roles: { adminRoleIds: [], supportRoleIds: [] },
  commandPermissions: {},
  allowedChannelIds: [],
  customerRoleId: null
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Discord IDs exceed JavaScript's safe integer range, so unquoted IDs in
 * config.json silently lose precision. Reject them with a loud warning.
 */
function warnOnNumericIds(fieldName: string, value: unknown): void {
  if (Array.isArray(value) && value.some((entry) => typeof entry === 'number')) {
    console.warn(
      `config.json: ${fieldName} contains unquoted numeric IDs, which corrupts Discord IDs. ` +
        'Wrap each ID in quotes, e.g. ["123456789012345678"]. These entries are being IGNORED.'
    );
  }
}

function isPermissionLevel(value: unknown): value is PermissionLevel {
  return typeof value === 'string' && (PERMISSION_LEVELS as readonly string[]).includes(value);
}

function parseRoles(raw: unknown): RoleConfig {
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_CONFIG.roles;
  }
  const candidate = raw as Record<string, unknown>;
  warnOnNumericIds('roles.adminRoleIds', candidate['adminRoleIds']);
  warnOnNumericIds('roles.supportRoleIds', candidate['supportRoleIds']);
  return {
    adminRoleIds: isStringArray(candidate['adminRoleIds']) ? candidate['adminRoleIds'] : [],
    supportRoleIds: isStringArray(candidate['supportRoleIds']) ? candidate['supportRoleIds'] : []
  };
}

function parseCommandPermissions(raw: unknown): Record<string, PermissionLevel> {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const permissions: Record<string, PermissionLevel> = {};
  for (const [commandName, level] of Object.entries(raw)) {
    if (isPermissionLevel(level)) {
      permissions[commandName] = level;
    } else {
      console.warn(
        `config.json: ignoring invalid permission level "${String(level)}" for command "${commandName}". ` +
          `Valid levels: ${PERMISSION_LEVELS.join(', ')}.`
      );
    }
  }
  return permissions;
}

export function loadBotConfig(): SellBotConfig {
  if (!existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    console.error(`Could not parse ${CONFIG_FILE}, using defaults:`, error);
    return DEFAULT_CONFIG;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    console.error(`${CONFIG_FILE} must contain a JSON object, using defaults.`);
    return DEFAULT_CONFIG;
  }

  const candidate = parsed as Record<string, unknown>;
  warnOnNumericIds('allowedChannelIds', candidate['allowedChannelIds']);
  const rawCustomerRoleId = candidate['customerRoleId'];
  return {
    roles: parseRoles(candidate['roles']),
    commandPermissions: parseCommandPermissions(candidate['commandPermissions']),
    allowedChannelIds: isStringArray(candidate['allowedChannelIds'])
      ? candidate['allowedChannelIds']
      : [],
    customerRoleId:
      typeof rawCustomerRoleId === 'string' && rawCustomerRoleId.trim() !== ''
        ? rawCustomerRoleId.trim()
        : null
  };
}

/**
 * Resolves the permission level for a command invocation. A subcommand entry
 * like "top customers" wins over the parent "top" entry; unlisted commands
 * default to "admin".
 */
export function permissionLevelFor(
  config: SellBotConfig,
  commandName: string,
  subcommandName?: string | null
): PermissionLevel {
  if (subcommandName !== undefined && subcommandName !== null) {
    const subcommandLevel = config.commandPermissions[`${commandName} ${subcommandName}`];
    if (subcommandLevel !== undefined) {
      return subcommandLevel;
    }
  }
  return config.commandPermissions[commandName] ?? 'admin';
}

/** All permission levels that apply to a command, including its subcommand overrides. */
export function permissionLevelsForCommand(
  config: SellBotConfig,
  commandName: string
): PermissionLevel[] {
  const levels = [permissionLevelFor(config, commandName)];
  const subcommandPrefix = `${commandName} `;
  for (const [key, level] of Object.entries(config.commandPermissions)) {
    if (key.startsWith(subcommandPrefix)) {
      levels.push(level);
    }
  }
  return levels;
}

export function rolesForLevel(
  config: SellBotConfig,
  level: Exclude<PermissionLevel, 'everyone'>
): readonly string[] {
  if (level === 'admin') {
    return config.roles.adminRoleIds;
  }
  return [...config.roles.supportRoleIds, ...config.roles.adminRoleIds];
}
