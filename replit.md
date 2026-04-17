# Discord AI Scripting Bot

## Overview
A Discord bot focused on scripting and AI assistance, powered by Google Gemini. Works in DMs and servers.

## Stack
- Runtime: Node.js
- Discord library: discord.js v14
- AI: Google Gemini (gemini-1.5-flash) via @google/generative-ai
- Database: SQLite via better-sqlite3
- Key generation: uuid

## Environment Variables
- `DISCORD_TOKEN` — Discord bot token (secret)
- `GEMINI_API_KEY` — Google Gemini API key (secret)
- `OWNER_ID` — Owner Discord user ID (env var, set to 1397488831514808341)

## Files
- `bot.js` — Main bot file with all slash commands
- `bot.db` — SQLite database (auto-created on first run)
- `package.json` — Dependencies and start script

## Commands

### User Commands
- `/scan [user]` — Get all public info about a Discord user
- `/askai [question]` — Ask the AI a question (requires a redeemed key)
- `/redeem [key]` — Redeem a one-time key to unlock /askai
- `/config [setting] [value]` — Configure AI behaviour (codeblocks, language, style, systemprompt, reset)
- `/myconfig` — View your current AI configuration
- `/help` — Show all available commands
- `/about` — About the bot

### Owner-Only Commands (ID: 1397488831514808341)
- `/key-gen [amount]` — Generate one-time use keys (1-20)
- `/keys` — View all generated keys and usage status
- `/blacklist [userid]` — Blacklist a user from /askai
- `/remove [userid]` — Remove a user from the blacklist
- `/revoke [userid]` — Remove a user's redeemed access entirely
- `/stats` — View bot statistics

## Database Tables
- `keys` — One-time use keys with used/available status
- `authorized_users` — Users who have redeemed a key
- `blacklist` — Blacklisted users
- `user_config` — Per-user AI configuration settings

## Workflow
- Workflow name: "Discord Bot"
- Command: `npm start`
- Output type: console
