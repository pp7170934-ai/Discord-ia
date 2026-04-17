const keepAlive = require('./keep_alive');
keepAlive();

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionsBitField, ApplicationCommandOptionType } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const OWNER_ID = process.env.OWNER_ID || '1397488831514808341';
const TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const db = new Database('bot.db');
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    key TEXT PRIMARY KEY,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    used_by TEXT
  );

  CREATE TABLE IF NOT EXISTS authorized_users (
    user_id TEXT PRIMARY KEY,
    redeemed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS blacklist (
    user_id TEXT PRIMARY KEY,
    blacklisted_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_config (
    user_id TEXT PRIMARY KEY,
    system_prompt TEXT DEFAULT '',
    use_codeblocks INTEGER DEFAULT 0,
    language TEXT DEFAULT 'english',
    response_style TEXT DEFAULT 'balanced'
  );
`);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: ['CHANNEL']
});

const commands = [
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Get all public info about a Discord user')
    .addUserOption(opt => opt.setName('user').setDescription('The user to scan').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('askai')
    .setDescription('Ask the AI a question (requires a valid key)')
    .addStringOption(opt => opt.setName('question').setDescription('Your question').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a key to use /askai')
    .addStringOption(opt => opt.setName('key').setDescription('Your key').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure the AI behaviour for your account')
    .addStringOption(opt =>
      opt.setName('setting')
        .setDescription('Setting to configure')
        .setRequired(true)
        .addChoices(
          { name: 'codeblocks - Always wrap code in codeblocks', value: 'codeblocks' },
          { name: 'language - Set response language', value: 'language' },
          { name: 'style - Set response style', value: 'style' },
          { name: 'systemprompt - Custom system prompt', value: 'systemprompt' },
          { name: 'reset - Reset all settings to default', value: 'reset' }
        )
    )
    .addStringOption(opt => opt.setName('value').setDescription('The value for this setting'))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('myconfig')
    .setDescription('View your current AI configuration')
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands')
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('key-gen')
    .setDescription('[OWNER] Generate a one-time use key')
    .addIntegerOption(opt => opt.setName('amount').setDescription('Number of keys to generate (default 1)').setMinValue(1).setMaxValue(20))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('[OWNER] Blacklist a user from using /askai')
    .addStringOption(opt => opt.setName('userid').setDescription('User ID to blacklist').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('[OWNER] Remove a user from the blacklist')
    .addStringOption(opt => opt.setName('userid').setDescription('User ID to remove from blacklist').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('keys')
    .setDescription('[OWNER] View all generated keys and their status')
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('revoke')
    .setDescription('[OWNER] Revoke access from a user (removes their key redemption)')
    .addStringOption(opt => opt.setName('userid').setDescription('User ID to revoke').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('[OWNER] View bot statistics')
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('about')
    .setDescription('About this bot')
    .setDMPermission(true),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('Registering slash commands...');
    const clientId = client.user.id;
    await rest.put(Routes.applicationCommands(clientId), { body: commands.map(c => c.toJSON()) });
    console.log('Slash commands registered globally.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

function isOwner(userId) {
  return userId === OWNER_ID;
}

function isBlacklisted(userId) {
  const row = db.prepare('SELECT 1 FROM blacklist WHERE user_id = ?').get(userId);
  return !!row;
}

function isAuthorized(userId) {
  const row = db.prepare('SELECT 1 FROM authorized_users WHERE user_id = ?').get(userId);
  return !!row;
}

function getUserConfig(userId) {
  let config = db.prepare('SELECT * FROM user_config WHERE user_id = ?').get(userId);
  if (!config) {
    db.prepare('INSERT OR IGNORE INTO user_config (user_id) VALUES (?)').run(userId);
    config = db.prepare('SELECT * FROM user_config WHERE user_id = ?').get(userId);
  }
  return config;
}

function buildAIPrompt(config, question) {
  let systemParts = [];
  systemParts.push('You are a helpful AI assistant specialized in scripting, coding, and programming.');
  if (config.use_codeblocks) systemParts.push('Always wrap any code, scripts, or commands in proper Discord markdown codeblocks with the correct language tag.');
  if (config.language && config.language !== 'english') systemParts.push(`Respond in ${config.language}.`);
  if (config.response_style === 'concise') systemParts.push('Keep responses concise and to the point.');
  if (config.response_style === 'detailed') systemParts.push('Give detailed, thorough explanations.');
  if (config.system_prompt) systemParts.push(config.system_prompt);
  return { system: systemParts.join(' '), question };
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('/help | AI Scripting Bot', { type: 2 });
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;

  if (commandName === 'about') {
    const embed = new EmbedBuilder()
      .setTitle('AI Scripting Bot')
      .setDescription('A powerful AI assistant focused on scripting & coding, powered by Gemini.')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Commands', value: 'Use `/help` to see all available commands.' },
        { name: 'Access', value: 'Use `/redeem` with a valid key to unlock `/askai`.' },
        { name: 'Powered by', value: 'Google Gemini' }
      )
      .setFooter({ text: 'Works in DMs and servers' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'help') {
    const userCommands = [
      '`/scan [user]` — Get public info about a Discord user',
      '`/askai [question]` — Ask the AI a question (key required)',
      '`/redeem [key]` — Redeem a one-time key to unlock AI',
      '`/config [setting] [value]` — Configure AI behaviour',
      '`/myconfig` — View your current AI settings',
      '`/about` — About this bot',
      '`/help` — Show this message',
    ];
    const ownerCommands = [
      '`/key-gen [amount]` — Generate one-time keys',
      '`/keys` — View all keys & status',
      '`/blacklist [userid]` — Blacklist a user from AI',
      '`/remove [userid]` — Remove user from blacklist',
      '`/revoke [userid]` — Revoke a user\'s access',
      '`/stats` — Bot statistics',
    ];
    const embed = new EmbedBuilder()
      .setTitle('Command List')
      .setColor(0x5865F2)
      .addFields(
        { name: 'User Commands', value: userCommands.join('\n') },
      );
    if (isOwner(user.id)) {
      embed.addFields({ name: 'Owner Commands', value: ownerCommands.join('\n') });
    }
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'scan') {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('user');
    try {
      const fetched = await client.users.fetch(target.id, { force: true });
      const createdAt = `<t:${Math.floor(fetched.createdTimestamp / 1000)}:F>`;
      const avatarUrl = fetched.displayAvatarURL({ size: 1024, dynamic: true });
      const bannerUrl = fetched.bannerURL ? fetched.bannerURL({ size: 1024 }) : null;

      const embed = new EmbedBuilder()
        .setTitle(`User Scan: ${fetched.username}`)
        .setColor(fetched.accentColor || 0x5865F2)
        .setThumbnail(avatarUrl)
        .addFields(
          { name: 'Username', value: `${fetched.username}`, inline: true },
          { name: 'Display Name', value: fetched.globalName || fetched.username, inline: true },
          { name: 'User ID', value: `\`${fetched.id}\``, inline: true },
          { name: 'Account Created', value: createdAt, inline: false },
          { name: 'Bot?', value: fetched.bot ? 'Yes' : 'No', inline: true },
          { name: 'Avatar URL', value: `[Click here](${avatarUrl})`, inline: true },
        );

      if (bannerUrl) embed.addFields({ name: 'Banner URL', value: `[Click here](${bannerUrl})`, inline: true });
      if (fetched.accentColor) embed.addFields({ name: 'Accent Color', value: `#${fetched.accentColor.toString(16).padStart(6, '0')}`, inline: true });

      const badges = fetched.flags?.toArray() || [];
      if (badges.length > 0) embed.addFields({ name: 'Badges', value: badges.join(', '), inline: false });

      embed.setImage(bannerUrl || null);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `Could not fetch user info. Make sure the user ID is valid.` });
    }
  }

  if (commandName === 'redeem') {
    const keyInput = interaction.options.getString('key').trim();
    const row = db.prepare('SELECT * FROM keys WHERE key = ?').get(keyInput);
    if (!row) return interaction.reply({ content: 'Invalid key.', ephemeral: true });
    if (row.used) return interaction.reply({ content: 'This key has already been used.', ephemeral: true });
    if (isAuthorized(user.id)) return interaction.reply({ content: 'You already have access to `/askai`!', ephemeral: true });

    db.prepare('UPDATE keys SET used = 1, used_by = ? WHERE key = ?').run(user.id, keyInput);
    db.prepare('INSERT OR IGNORE INTO authorized_users (user_id) VALUES (?)').run(user.id);

    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x57F287).setDescription('Key redeemed! You now have access to `/askai`.')],
      ephemeral: true
    });
  }

  if (commandName === 'askai') {
    if (isBlacklisted(user.id)) {
      return interaction.reply({ content: 'You have been blacklisted from using this command.', ephemeral: true });
    }
    if (!isAuthorized(user.id) && !isOwner(user.id)) {
      return interaction.reply({ content: 'You need to redeem a key first. Use `/redeem [key]`.', ephemeral: true });
    }

    const question = interaction.options.getString('question');
    await interaction.deferReply();

    try {
      const config = getUserConfig(user.id);
      const { system, question: q } = buildAIPrompt(config, question);

      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', systemInstruction: system });
      const result = await model.generateContent(q);
      const text = result.response.text();

      const chunks = [];
      let remaining = text;
      while (remaining.length > 1900) {
        chunks.push(remaining.slice(0, 1900));
        remaining = remaining.slice(1900);
      }
      if (remaining) chunks.push(remaining);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: `Question by ${user.username}`, iconURL: user.displayAvatarURL() })
        .setDescription(chunks[0])
        .setFooter({ text: 'Powered by Gemini' });

      await interaction.editReply({ embeds: [embed] });

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i] });
      }
    } catch (err) {
      console.error('AI error:', err);
      return interaction.editReply({ content: 'An error occurred while contacting the AI. Please try again later.' });
    }
  }

  if (commandName === 'config') {
    const setting = interaction.options.getString('setting');
    const value = interaction.options.getString('value');

    if (setting === 'reset') {
      db.prepare('DELETE FROM user_config WHERE user_id = ?').run(user.id);
      return interaction.reply({ content: 'Your AI configuration has been reset to defaults.', ephemeral: true });
    }

    if (!value) return interaction.reply({ content: 'Please provide a value for this setting.', ephemeral: true });

    getUserConfig(user.id);

    if (setting === 'codeblocks') {
      const val = value.toLowerCase() === 'on' || value.toLowerCase() === 'true' || value === '1' ? 1 : 0;
      db.prepare('UPDATE user_config SET use_codeblocks = ? WHERE user_id = ?').run(val, user.id);
      return interaction.reply({ content: `Codeblocks are now **${val ? 'enabled' : 'disabled'}**.`, ephemeral: true });
    }

    if (setting === 'language') {
      db.prepare('UPDATE user_config SET language = ? WHERE user_id = ?').run(value, user.id);
      return interaction.reply({ content: `Response language set to **${value}**.`, ephemeral: true });
    }

    if (setting === 'style') {
      const allowed = ['balanced', 'concise', 'detailed'];
      if (!allowed.includes(value.toLowerCase())) {
        return interaction.reply({ content: `Invalid style. Choose from: \`balanced\`, \`concise\`, \`detailed\`.`, ephemeral: true });
      }
      db.prepare('UPDATE user_config SET response_style = ? WHERE user_id = ?').run(value.toLowerCase(), user.id);
      return interaction.reply({ content: `Response style set to **${value}**.`, ephemeral: true });
    }

    if (setting === 'systemprompt') {
      if (value.length > 500) return interaction.reply({ content: 'System prompt must be under 500 characters.', ephemeral: true });
      db.prepare('UPDATE user_config SET system_prompt = ? WHERE user_id = ?').run(value, user.id);
      return interaction.reply({ content: `Custom system prompt saved.`, ephemeral: true });
    }
  }

  if (commandName === 'myconfig') {
    const config = getUserConfig(user.id);
    const embed = new EmbedBuilder()
      .setTitle('Your AI Configuration')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Codeblocks', value: config.use_codeblocks ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Language', value: config.language || 'english', inline: true },
        { name: 'Style', value: config.response_style || 'balanced', inline: true },
        { name: 'Custom System Prompt', value: config.system_prompt || '_None_', inline: false }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'key-gen') {
    if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    const amount = interaction.options.getInteger('amount') || 1;
    const generated = [];
    for (let i = 0; i < amount; i++) {
      const key = uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();
      db.prepare('INSERT INTO keys (key) VALUES (?)').run(key);
      generated.push(`\`${key}\``);
    }
    const embed = new EmbedBuilder()
      .setTitle(`Generated ${amount} Key${amount > 1 ? 's' : ''}`)
      .setColor(0x57F287)
      .setDescription(generated.join('\n'))
      .setFooter({ text: 'Each key is single-use. Share via DM.' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'keys') {
    if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    const rows = db.prepare('SELECT * FROM keys ORDER BY created_at DESC LIMIT 30').all();
    if (!rows.length) return interaction.reply({ content: 'No keys generated yet.', ephemeral: true });
    const lines = rows.map(r => `\`${r.key}\` — ${r.used ? `Used by ${r.used_by}` : 'Available'}`);
    const embed = new EmbedBuilder()
      .setTitle('All Keys (last 30)')
      .setColor(0x5865F2)
      .setDescription(lines.join('\n'));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'blacklist') {
    if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    const targetId = interaction.options.getString('userid');
    db.prepare('INSERT OR IGNORE INTO blacklist (user_id) VALUES (?)').run(targetId);
    return interaction.reply({ content: `User \`${targetId}\` has been blacklisted from /askai.`, ephemeral: true });
  }

  if (commandName === 'remove') {
    if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    const targetId = interaction.options.getString('userid');
    const result = db.prepare('DELETE FROM blacklist WHERE user_id = ?').run(targetId);
    if (result.changes === 0) return interaction.reply({ content: `User \`${targetId}\` was not blacklisted.`, ephemeral: true });
    return interaction.reply({ content: `User \`${targetId}\` has been removed from the blacklist.`, ephemeral: true });
  }

  if (commandName === 'revoke') {
    if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    const targetId = interaction.options.getString('userid');
    const result = db.prepare('DELETE FROM authorized_users WHERE user_id = ?').run(targetId);
    if (result.changes === 0) return interaction.reply({ content: `User \`${targetId}\` does not have access.`, ephemeral: true });
    return interaction.reply({ content: `Access revoked for user \`${targetId}\`.`, ephemeral: true });
  }

  if (commandName === 'stats') {
    if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    const totalKeys = db.prepare('SELECT COUNT(*) as c FROM keys').get().c;
    const usedKeys = db.prepare('SELECT COUNT(*) as c FROM keys WHERE used = 1').get().c;
    const authorizedUsers = db.prepare('SELECT COUNT(*) as c FROM authorized_users').get().c;
    const blacklisted = db.prepare('SELECT COUNT(*) as c FROM blacklist').get().c;
    const servers = client.guilds.cache.size;

    const embed = new EmbedBuilder()
      .setTitle('Bot Statistics')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Servers', value: `${servers}`, inline: true },
        { name: 'Total Keys Generated', value: `${totalKeys}`, inline: true },
        { name: 'Keys Used', value: `${usedKeys}`, inline: true },
        { name: 'Authorized Users', value: `${authorizedUsers}`, inline: true },
        { name: 'Blacklisted Users', value: `${blacklisted}`, inline: true },
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.login(TOKEN).catch(err => {
  console.error('Failed to login:', err.message);
  process.exit(1);
});
