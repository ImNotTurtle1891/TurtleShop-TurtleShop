import { analyticsCommand } from './analytics.js';
import { statsCommand } from './stats.js';
import { topCommand } from './top.js';
import type { Command } from './types.js';

export const commands: readonly Command[] = [statsCommand, analyticsCommand, topCommand];
