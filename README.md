# SellBot

A self-hosted Discord bot for [SellAuth](https://sellauth.com) shop owners. View your shop's stats, revenue analytics, and top performers directly from Discord using slash commands.

## Commands

| Command | Description |
| --- | --- |
| `/stats` | Lifetime shop statistics: products sold, customers, completed orders, feedback count, and average rating. |
| `/analytics [timeframe]` | Revenue, orders, and customers for a timeframe, with change vs. the previous period. |
| `/top products [timeframe]` | Top 10 products by revenue. |
| `/top customers [timeframe]` | Top 10 customers by revenue (emails are masked). |
| `/top payment-methods [timeframe]` | Top payment methods by revenue. |
| `/products [search] [page]` | Browse products with prices and stock counts, optionally filtered by name. |
| `/product <name>` | Detailed view of one product with per-variant prices and stock. The name option autocompletes from your live catalog. |
| `/commands` | List all SellBot commands and the permission level each one requires. |
| `/redeemorder <orderid>` | Customers verify a completed order and receive the customer role. |
| `/claimorder-embed` | Admins post a permanent embed with a "Claim Order" button that opens an order-ID form. |
| `/customer <email>` | Look up a customer: spend, balance, Discord account, and their full order history with ◀ ▶ pagination. |
| `/order check <id>` | Full details of one order: status, total, payment method, customer, items, feedback, IP, blacklist flags, and who claimed it. Accepts the numeric or unique invoice ID. |
| `/order complete <id>` | Mark an order as completed. |
| `/order refund <id>` | Mark an order as refunded (does not move money — process the actual refund with your payment provider). |
| `/order cancel <id>` | Mark an order as cancelled. |
| `/order resend-email <id> [email]` | Resend the order confirmation email, optionally to a different address. |
| `/coupon list [page]` | List coupons with discount, usage counts, total savings, and expiry. |
| `/coupon create <code> <discount> <type> [...]` | Create an all-products coupon. Optional: max uses, uses per customer, minimum order value, expiry in days. |
| `/coupon delete <code>` | Delete a coupon. The code option autocompletes from your live coupons. |
| `/blacklist list [page]` | List blacklist entries with type, reason, and date. |
| `/blacklist add <type> <value> [reason]` | Block an email, email domain, Discord ID, IP, IP range, country, city, ISP, ASN, or user agent. |
| `/blacklist remove <value>` | Remove a blacklist entry. Autocompletes from your live blacklist. |
| `/blacklist check <value>` | Check whether a value is blacklisted and why (support-level by default). |
| `/createinvoice product <product> [...]` | Create an invoice for a catalog product and get a checkout link. The product option autocompletes with variants and prices. Optional: quantity, customer email, coupon. |
| `/createinvoice custom <name> <price> [...]` | Create an invoice for a one-off charge that is not in your catalog. Optional: currency, quantity, customer email, coupon. Requires a SellAuth plan with the Checkout API feature. |
| `/feedback recent [page] [rating] [written]` | Recent reviews, newest first. Filter by star rating or to customer-written reviews only. |
| `/feedback stats` | Rating breakdown with per-star bars, average, and reply rate. |
| `/feedback reply <id> <message>` | Post a public reply to a review (the ID is shown in `/feedback recent`). |
| `/ticket list [status] [email] [page]` | List support tickets, newest first, filterable by status or customer. |
| `/ticket view <id>` | A ticket with its recent messages. The ID option autocompletes by subject and customer. |
| `/ticket reply <id> <message>` | Send a message to a ticket as the shop. |
| `/ticket close <id>` / `/ticket reopen <id>` | Close or reopen a ticket. |

Available timeframes: today, last 7/30/90/365 days, and all time. The default is the last 30 days.

All responses are ephemeral (only visible to the person who ran the command). Without any configuration, commands require the **Manage Server** permission. See [Configuration](#configuration) to use your own admin/support roles instead.

## Configuration

Copy `config.example.json` to `config.json` to control who can use which commands and where:

```json
{
  "roles": {
    "adminRoleIds": ["123456789012345678"],
    "supportRoleIds": ["234567890123456789"]
  },
  "commandPermissions": {
    "stats": "admin",
    "analytics": "admin",
    "top": "support",
    "top customers": "admin"
  },
  "allowedChannelIds": ["345678901234567890"],
  "customerRoleId": "456789012345678901"
}
```

> **Important:** always wrap Discord IDs in quotes. Unquoted numeric IDs get corrupted because they exceed JavaScript's safe integer range.

- **`roles.adminRoleIds` / `roles.supportRoleIds`** — Discord role IDs (right-click a role → Copy Role ID, with Developer Mode enabled). Members with an admin role can use everything; support roles only unlock commands set to `"support"`.
- **`commandPermissions`** — permission level per command: `"admin"`, `"support"`, or `"everyone"`. Commands not listed default to `"admin"`. Subcommands can override their parent with a `"command subcommand"` key — in the example above, support staff can use `/top products`, but `/top customers` stays admin-only.
- **`allowedChannelIds`** — channel or category IDs where commands are allowed. A category ID allows every channel inside it. Leave empty to allow commands everywhere.
- **`customerRoleId`** — the role granted when a member claims a completed order via `/redeemorder` or the claim button. Leave empty to disable order claiming. The bot needs the **Manage Roles** permission and its role must be *above* the customer role in your server's role list. Each order can only be claimed by one Discord user (tracked in `data/claims.json`).

Notes:

- Server Administrators always have access, so you can never lock yourself out.
- If no roles are configured for a level, that level falls back to requiring the **Manage Server** permission.
- After changing `config.json`, restart the bot and re-run `npm run deploy-commands` (command visibility in Discord's UI is set at registration time).
- `config.json` is gitignored since it contains your server-specific IDs.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer
- A [SellAuth](https://sellauth.com) shop and API key
- A Discord application with a bot user

## Setup

### 1. Create a Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. On the **Bot** tab, click **Reset Token** and copy the token — this is your `DISCORD_TOKEN`.
3. On the **General Information** tab, copy the **Application ID** — this is your `DISCORD_CLIENT_ID`.
4. Invite the bot to your server using this URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=268435456
```

The `permissions=268435456` part grants **Manage Roles**, which is needed for the order-claim feature to assign the customer role.

### 2. Get your SellAuth credentials

1. Get your API key from the SellAuth dashboard under [Account → Developers](https://dash.sellauth.com/api) — this is your `SELLAUTH_API_KEY`.
2. Find your shop's numeric ID — this is your `SELLAUTH_SHOP_ID`.

### 3. Configure and run the bot

**Windows quick start:** double-click `startbot.bat`. It checks that Node.js is installed, creates a `.env` file for you to fill in on first run, then installs dependencies, validates your configuration, registers the slash commands, and starts the bot.

**Manual setup (all platforms):**

```bash
git clone https://github.com/YOUR_USERNAME/Sellauth-Discord-Bot.git
cd Sellauth-Discord-Bot
npm install

# Create your environment file and fill in the values from steps 1 and 2
cp .env.example .env

# Register the slash commands with Discord (run once, and again whenever commands change)
npm run deploy-commands

# Start the bot
npm run build
npm start
```

For development with automatic reload on file changes:

```bash
npm run dev
```

## Troubleshooting

**The bot replies or posts embeds twice, or logs `Unknown interaction` / `Interaction has already been acknowledged` errors.**
Two copies of the bot are running with the same token, and they race each other on every interaction. Common cause: `npm run dev` left running in one terminal while `startbot.bat` or `npm start` runs in another. Close all but one instance. If you can't find the extra instance (e.g. it's on another machine), reset the bot token in the [Discord Developer Portal](https://discord.com/developers/applications) — that disconnects everything, then start a single instance with the new token.

## Security notes

- Your `.env` file contains secrets. It is gitignored — never commit it or share its contents.
- Your SellAuth API key has full access to your shop. Only run this bot on machines you control.
- Customer emails are masked in `/top customers` output, but revenue data is still sensitive — keep the commands admin-only unless you're comfortable sharing it.

## License

SellBot was made by **Barkie** ([barkiedev.cc](https://barkiedev.cc)) and is released under the [MIT License](LICENSE).

That means you're free to use, customize, self-host, and redistribute it however you want — build something good with it. The software is provided as-is: Barkie / barkiedev.cc is not responsible for anything that happens through your use of it, including (but not limited to) lost sales, misconfigured permissions, or actions taken on your SellAuth shop. See the [LICENSE](LICENSE) file for the full terms.
