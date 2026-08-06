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

Available timeframes: today, last 7/30/90/365 days, and all time. The default is the last 30 days.

All responses are ephemeral (only visible to the person who ran the command), and commands require the **Manage Server** permission by default. Server admins can adjust this per command under **Server Settings → Integrations**.

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
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands
```

### 2. Get your SellAuth credentials

1. Get your API key from the SellAuth dashboard under [Account → Developers](https://dash.sellauth.com/api) — this is your `SELLAUTH_API_KEY`.
2. Find your shop's numeric ID — this is your `SELLAUTH_SHOP_ID`.

### 3. Configure and run the bot

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

## Security notes

- Your `.env` file contains secrets. It is gitignored — never commit it or share its contents.
- Your SellAuth API key has full access to your shop. Only run this bot on machines you control.
- Customer emails are masked in `/top customers` output, but revenue data is still sensitive — keep the commands admin-only unless you're comfortable sharing it.

## License

MIT
