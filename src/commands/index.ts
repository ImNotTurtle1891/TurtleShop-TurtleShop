import { activityCommand } from './activity.js';
import { affiliateCommand } from './affiliate.js';
import { analyticsCommand } from './analytics.js';
import { blacklistCommand } from './blacklist.js';
import { claimOrderEmbedCommand } from './claimorder-embed.js';
import { commandsCommand } from './commands.js';
import { couponCommand } from './coupon.js';
import { createInvoiceCommand } from './createinvoice.js';
import { customerCommand } from './customer.js';
import { feedbackCommand } from './feedback.js';
import { notificationsCommand } from './notifications.js';
import { orderCommand } from './order.js';
import { paymentMethodsCommand } from './paymentmethods.js';
import { productCommand } from './product.js';
import { productsCommand } from './products.js';
import { redeemOrderCommand } from './redeemorder.js';
import { resellerCommand } from './reseller.js';
import { restockCommand } from './restock.js';
import { statsCommand } from './stats.js';
import { statusCommand } from './status.js';
import { stockCommand } from './stock.js';
import { ticketCommand } from './ticket.js';
import { topCommand } from './top.js';
import { trafficCommand } from './traffic.js';
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
  couponCommand,
  blacklistCommand,
  createInvoiceCommand,
  feedbackCommand,
  ticketCommand,
  restockCommand,
  stockCommand,
  statusCommand,
  paymentMethodsCommand,
  trafficCommand,
  notificationsCommand,
  activityCommand,
  affiliateCommand,
  resellerCommand
];
