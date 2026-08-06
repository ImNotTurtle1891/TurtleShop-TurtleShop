import { analyticsCommand } from './analytics.js';
import { claimOrderEmbedCommand } from './claimorder-embed.js';
import { commandsCommand } from './commands.js';
import { couponCommand } from './coupon.js';
import { customerCommand } from './customer.js';
import { orderCommand } from './order.js';
import { productCommand } from './product.js';
import { productsCommand } from './products.js';
import { redeemOrderCommand } from './redeemorder.js';
import { statsCommand } from './stats.js';
import { topCommand } from './top.js';
import type { Command } from './types.js';

export const commands: readonly Command[] = [
  statsCommand,
  analyticsCommand,
  topCommand,
  productsCommand,
  productCommand,
  commandsCommand,
  redeemOrderCommand,
  claimOrderEmbedCommand,
  customerCommand,
  orderCommand,
  couponCommand
];
