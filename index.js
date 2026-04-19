

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Groq = require('groq-sdk');
const keepAlive = require('./keep_alive');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { parseRBXM, renderHierarchy, calculateFlags } = require('./rbxm-parser');
const { setupEmojis } = require('./setup-emojis');
const fs = require('fs');

let emojiConfig = null;
try {
  emojiConfig = JSON.parse(fs.readFileSync('./emoji-config.json', 'utf8'));
} catch (_) {}


const OWNER_ID = process.env.OWNER_ID || '1397488831514808341';
const TOKEN = process.env.DISCORD_TOKEN;

const db = new Database('bot.db');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

  CREATE TABLE IF NOT EXISTS admins (
    user_id TEXT PRIMARY KEY,
    added_by TEXT,
    added_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS global_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    username TEXT,
    action TEXT,
    detail TEXT,
    logged_at TEXT DEFAULT (datetime('now'))
  );
`);

let maintenanceMode = false;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.MessageContent,
  ],
  partials: ['CHANNEL', 'MESSAGE', 'REACTION']
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
    .addAttachmentOption(opt => opt.setName('file').setDescription('Optional file or image for the AI to analyse'))
    .addAttachmentOption(opt => opt.setName('image').setDescription('Optional image for the AI to analyse'))
    .addBooleanOption(opt => opt.setName('txt_file').setDescription('Send the AI answer as a .txt file'))
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
    .setName('whitelist')
    .setDescription('[OWNER] Give a user AI access without a key')
    .addStringOption(opt => opt.setName('userid').setDescription('User ID to whitelist').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('[OWNER] View bot statistics')
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('about')
    .setDescription('About this bot')
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency')
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Get the avatar of a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to get avatar of'))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('explain')
    .setDescription('Ask the AI to explain a piece of code (requires key)')
    .addStringOption(opt => opt.setName('code').setDescription('The code to explain').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('broadcast')
    .setDescription('[OWNER] Broadcast a message to all servers the bot is in')
    .addStringOption(opt => opt.setName('message').setDescription('Message to broadcast').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('[OWNER] Toggle maintenance mode (disables /askai for users)')
    .addStringOption(opt =>
      opt.setName('status')
        .setDescription('on or off')
        .setRequired(true)
        .addChoices(
          { name: 'On', value: 'on' },
          { name: 'Off', value: 'off' }
        )
    )
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('clearkeys')
    .setDescription('[OWNER] Delete all unused keys')
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('admin-add')
    .setDescription('[OWNER] Grant admin privileges to a user')
    .addStringOption(opt => opt.setName('userid').setDescription('User ID to make admin').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('admin-remove')
    .setDescription('[OWNER] Remove admin privileges from a user')
    .addStringOption(opt => opt.setName('userid').setDescription('User ID to remove from admins').setRequired(true))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('[OWNER/ADMIN] View recent activity logs')
    .addIntegerOption(opt => opt.setName('limit').setDescription('Number of entries (default 10, max 25)').setMinValue(1).setMaxValue(25))
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('ranks')
    .setDescription('View all users and their rank (Owner, Admin, Authorized)')
    .setDMPermission(true),

  new SlashCommandBuilder()
    .setName('hierarchy')
    .setDescription('Parse an RBXM binary file and display its instance hierarchy')
    .addAttachmentOption(opt =>
      opt.setName('rbx_file')
        .setDescription('The .rbxm or .rbxl binary file to parse')
        .setRequired(true)
    )
    .setDMPermission(true),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('Registering slash commands...');
    const clientId = client.user.id;
    const commandsJson = commands.map(c => ({
      ...c.toJSON(),
      integration_types: [0, 1],
      contexts: [0, 1, 2],
    }));
    await rest.put(Routes.applicationCommands(clientId), { body: commandsJson });
    console.log('Slash commands registered globally with DM support.');
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

function isAdmin(userId) {
  const row = db.prepare('SELECT 1 FROM admins WHERE user_id = ?').get(userId);
  return !!row;
}

function logActivity(userId, username, action, detail = '') {
  db.prepare('INSERT INTO activity_log (user_id, username, action, detail) VALUES (?, ?, ?, ?)').run(userId, username, action, detail);
}

function getUserConfig(userId) {
  let config = db.prepare('SELECT * FROM user_config WHERE user_id = ?').get(userId);
  if (!config) {
    db.prepare('INSERT OR IGNORE INTO user_config (user_id) VALUES (?)').run(userId);
    config = db.prepare('SELECT * FROM user_config WHERE user_id = ?').get(userId);
  }
  return config;
}

const PERSONALITY_PROMPTS = {
  default:   'You are a helpful AI assistant specialized in scripting, coding, and programming.',
  assistant: 'You are a friendly, helpful general-purpose assistant. Answer clearly and helpfully.',
  coder:     'You are an expert programmer. Always format code correctly, be precise and technical.',
  tutor:     'You are a patient tutor. Explain concepts step by step in simple, clear terms.',
};

function getGlobalConfig() {
  const rows = db.prepare('SELECT key, value FROM global_config').all();
  const cfg = {
    system_prompt: '',
    model: 'llama-3.3-70b-versatile',
    temperature: 1.0,
    max_tokens: 1500,
    personality: 'default',
  };
  for (const row of rows) cfg[row.key] = row.value;
  cfg.temperature = parseFloat(cfg.temperature);
  cfg.max_tokens = parseInt(cfg.max_tokens);
  return cfg;
}

function buildAIPrompt(config, question) {
  const globalCfg = getGlobalConfig();
  let systemParts = [];
  systemParts.push(PERSONALITY_PROMPTS[globalCfg.personality] || PERSONALITY_PROMPTS.default);
  if (globalCfg.system_prompt) systemParts.push(globalCfg.system_prompt);
  if (config.use_codeblocks) systemParts.push('Always wrap any code, scripts, or commands in proper Discord markdown codeblocks with the correct language tag.');
  if (config.language && config.language !== 'english') systemParts.push(`Respond in ${config.language}.`);
  if (config.response_style === 'concise') systemParts.push('Keep responses concise and to the point.');
  if (config.response_style === 'detailed') systemParts.push('Give detailed, thorough explanations.');
  if (config.system_prompt) systemParts.push(config.system_prompt);
  return { system: systemParts.join(' '), question };
}

function isTextAttachment(attachment) {
  const contentType = (attachment.contentType || '').toLowerCase();
  const name = (attachment.name || '').toLowerCase();
  return contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('javascript') ||
    contentType.includes('typescript') ||
    contentType.includes('xml') ||
    contentType.includes('yaml') ||
    ['.txt', '.js', '.ts', '.jsx', '.tsx', '.json', '.lua', '.luau', '.py', '.html', '.css', '.md', '.xml', '.yml', '.yaml', '.csv', '.log'].some(ext => name.endsWith(ext));
}

async function readAttachmentText(attachment) {
  if (attachment.size > 512 * 1024) {
    throw new Error('That text file is too large. Please upload a file under 512 KB.');
  }
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Failed to download attachment: ${res.status}`);
  const text = await res.text();
  return text.length > 12000 ? text.slice(0, 12000) + '\n\n[File was shortened because it is too long.]' : text;
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('/help | AI Scripting Bot', { type: 2 });
  await registerCommands();
  try {
    emojiConfig = await setupEmojis(TOKEN);
  } catch (e) {
    console.error('[emojis] Setup failed:', e.message);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;

  if (commandName === 'about') {
    const embed = new EmbedBuilder()
      .setTitle('AI Scripting Bot')
      .setDescription('A powerful AI assistant focused on scripting & coding. Works in DMs and servers.')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Commands', value: 'Use `/help` to see all available commands.' },
        { name: 'Access', value: 'Use `/redeem` with a valid key to unlock `/askai` and `/explain`.' },
      )
      .setFooter({ text: 'Works in DMs and servers' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'help') {
    const userCommands = [
      '`/scan [user]` — Get public info about a Discord user',
      '`/avatar [user]` — Show a user\'s avatar',
      '`/askai [question]` — Ask the AI a question (key required)',
      '`/explain [code]` — AI explains a piece of code (key required)',
      '`/redeem [key]` — Redeem a one-time key to unlock AI',
      '`/config [setting] [value]` — Configure AI behaviour',
      '`/myconfig` — View your current AI settings',
      '`/ping` — Check bot latency',
      '`/hierarchy [rbx_file]` — Parse an RBXM/RBXL file and show its instance tree',
      '`/about` — About this bot',
      '`/help` — Show this message',
    ];
    const ownerCommands = [
      '`/key-gen [amount]` — Generate one-time keys',
      '`/keys` — View all keys & status',
      '`/clearkeys` — Delete all unused keys',
      '`/blacklist [userid]` — Blacklist a user from AI',
      '`/whitelist [userid]` — Give a user AI access without a key',
      '`/remove [userid]` — Remove user from blacklist',
      '`/revoke [userid]` — Revoke a user\'s access',
      '`/broadcast [message]` — Send message to all servers',
      '`/maintenance [on/off]` — Toggle maintenance mode',
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
    if (maintenanceMode && !isOwner(user.id)) {
      return interaction.reply({ content: 'The bot is currently in maintenance mode. Try again later.', ephemeral: true });
    }

    const question = interaction.options.getString('question');
    const attachment = interaction.options.getAttachment('file') || interaction.options.getAttachment('image');
    const answerAsFile = interaction.options.getBoolean('txt_file') || false;
    await interaction.deferReply();

    try {
      const config = getUserConfig(user.id);
      const { system, question: q } = buildAIPrompt(config, question);

      let userContent;
      const isImage = attachment && attachment.contentType && attachment.contentType.startsWith('image/');
      if (isImage) {
        userContent = [
          { type: 'text', text: q },
          { type: 'image_url', image_url: { url: attachment.url } }
        ];
      } else if (attachment) {
        if (!isTextAttachment(attachment)) {
          return interaction.editReply({ content: 'Please upload an image or a readable text/code file.' });
        }
        const fileText = await readAttachmentText(attachment);
        userContent = `${q}\n\nAttached file: ${attachment.name}\n\n${fileText}`;
      } else {
        userContent = q;
      }

      const globalCfg = getGlobalConfig();
      const model = isImage
        ? 'meta-llama/llama-4-scout-17b-16e-instruct'
        : globalCfg.model;

      const completion = await groq.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent }
        ],
        temperature: globalCfg.temperature,
        max_tokens: globalCfg.max_tokens,
      });
      logActivity(user.id, user.username, 'askai', question.slice(0, 100));
      const text = completion.choices[0].message.content;

      if (answerAsFile) {
        const file = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: 'askai-answer.txt' });
        return interaction.editReply({ content: 'Here is the AI answer as a text file:', files: [file] });
      }

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
    if (!isOwner(user.id) && !isAdmin(user.id)) return interaction.reply({ content: 'Only the owner or an admin can use this command.', ephemeral: true });
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
    if (!isOwner(user.id) && !isAdmin(user.id)) return interaction.reply({ content: 'Only the owner or an admin can use this command.', ephemeral: true });
    const targetId = interaction.options.getString('userid');
    const result = db.prepare('DELETE FROM authorized_users WHERE user_id = ?').run(targetId);
    if (result.changes === 0) return interaction.reply({ content: `User \`${targetId}\` does not have access.`, ephemeral: true });
    return interaction.reply({ content: `Access revoked for user \`${targetId}\`.`, ephemeral: true });
  }

  if (commandName === 'whitelist') {
    if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    const targetId = interaction.options.getString('userid');
    db.prepare('INSERT OR IGNORE INTO authorized_users (user_id) VALUES (?)').run(targetId);
    logActivity(user.id, user.username, 'whitelist', targetId);
    return interaction.reply({ content: `User \`${targetId}\` has been whitelisted and no longer needs a key.`, ephemeral: true });
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
        { name: 'Maintenance Mode', value: maintenanceMode ? 'ON' : 'OFF', inline: true },
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'ping') {
    const sent = await interaction.deferReply({ fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const wsLatency = client.ws.ping;
    const embed = new EmbedBuilder()
      .setTitle('Pong!')
      .setColor(0x57F287)
      .addFields(
        { name: 'Roundtrip', value: `${latency}ms`, inline: true },
        { name: 'WebSocket', value: `${wsLatency}ms`, inline: true }
      );
    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === 'avatar') {
    const target = interaction.options.getUser('user') || user;
    const fetched = await client.users.fetch(target.id, { force: true });
    const avatarUrl = fetched.displayAvatarURL({ size: 1024, dynamic: true });
    const embed = new EmbedBuilder()
      .setTitle(`${fetched.username}'s Avatar`)
      .setImage(avatarUrl)
      .setColor(0x5865F2)
      .setDescription(`[Open in browser](${avatarUrl})`);
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'explain') {
    if (isBlacklisted(user.id)) return interaction.reply({ content: 'You are blacklisted.', ephemeral: true });
    if (!isAuthorized(user.id) && !isOwner(user.id)) return interaction.reply({ content: 'You need to redeem a key first. Use `/redeem [key]`.', ephemeral: true });
    if (maintenanceMode && !isOwner(user.id)) return interaction.reply({ content: 'The bot is currently in maintenance mode. Try again later.', ephemeral: true });

    const code = interaction.options.getString('code');
    await interaction.deferReply();
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a coding expert. Explain the provided code clearly and concisely, covering what it does, how it works, and any notable patterns. Always use Discord markdown codeblocks when referencing code.' },
          { role: 'user', content: `Explain this code:\n\`\`\`\n${code}\n\`\`\`` }
        ],
        max_tokens: 1200,
      });
      const text = completion.choices[0].message.content;
      const embed = new EmbedBuilder()
        .setTitle('Code Explanation')
        .setColor(0x5865F2)
        .setDescription(text.length > 4096 ? text.slice(0, 4090) + '...' : text);
      return interaction.editReply({ embeds: [embed] });
    } catch {
      return interaction.editReply({ content: 'Could not explain the code right now. Try again later.' });
    }
  }

if (commandName === 'broadcast') {
        if (!isOwner(user.id)) return interaction.reply({ content: 'Only owner.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        const message = interaction.options.getString('message');
        let sent = 0;
        for (const guild of client.guilds.cache.values()) {
            try {
                const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages'));
                if (channel) { await channel.send(message); sent++; }
            } catch {}
        }
        return interaction.editReply({ content: `Broadcast sent to **${sent}** server(s).` });
    }

    if (commandName === 'maintenance') {
        if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
        const status = interaction.options.getString('status');
        maintenanceMode = (status === 'on');
        const msg = `Maintenance mode is now **${maintenanceMode ? 'ON' : 'OFF'}**. ${maintenanceMode ? 'Only you can use /askai.' : 'All users can use /askai.'}`;
        return interaction.reply({ content: msg, ephemeral: true });
    }

    if (commandName === 'clearkeys') {
        if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
        const result = db.prepare('DELETE FROM keys WHERE used = 0').run();
        return interaction.reply({ content: `Deleted **${result.changes}** unused key(s).`, ephemeral: true });
    }

  if (commandName === 'admin-add') {
    if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    const targetId = interaction.options.getString('userid');
    if (targetId === OWNER_ID) return interaction.reply({ content: 'The owner is already the highest authority.', ephemeral: true });
    db.prepare('INSERT OR IGNORE INTO admins (user_id, added_by) VALUES (?, ?)').run(targetId, user.id);
    logActivity(user.id, user.username, 'admin-add', targetId);
    return interaction.reply({ content: `✅ User \`${targetId}\` has been granted admin privileges. They can now use \`/revoke\`, \`/keys\`, and \`/logs\`.`, ephemeral: true });
  }

  if (commandName === 'admin-remove') {
    if (!isOwner(user.id)) return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    const targetId = interaction.options.getString('userid');
    const result = db.prepare('DELETE FROM admins WHERE user_id = ?').run(targetId);
    if (result.changes === 0) return interaction.reply({ content: `User \`${targetId}\` is not an admin.`, ephemeral: true });
    logActivity(user.id, user.username, 'admin-remove', targetId);
    return interaction.reply({ content: `✅ Admin privileges removed from \`${targetId}\`.`, ephemeral: true });
  }

  if (commandName === 'logs') {
    if (!isOwner(user.id) && !isAdmin(user.id)) return interaction.reply({ content: 'Only the owner or an admin can use this command.', ephemeral: true });
    const limit = interaction.options.getInteger('limit') || 10;
    const rows = db.prepare('SELECT * FROM activity_log ORDER BY logged_at DESC LIMIT ?').all(limit);
    if (!rows.length) return interaction.reply({ content: 'No activity logged yet.', ephemeral: true });
    const lines = rows.map(r => `\`[${r.logged_at}]\` **${r.action}** by <@${r.user_id}> — ${r.detail || '_no detail_'}`);
    const embed = new EmbedBuilder()
      .setTitle(`Recent Activity (last ${rows.length})`)
      .setColor(0x5865F2)
      .setDescription(lines.join('\n').slice(0, 4096));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'ranks') {
    await interaction.deferReply({ ephemeral: true });

    // Helper to fetch a display name from Discord
    async function fetchName(id) {
      try {
        const u = await client.users.fetch(id);
        return u.username;
      } catch {
        return 'Unknown User';
      }
    }

    // Owner
    const ownerName = await fetchName(OWNER_ID);
    const ownerLine = `👑 **${ownerName}** — \`${OWNER_ID}\``;

    // Admins
    const adminRows = db.prepare('SELECT user_id FROM admins').all();
    let adminLines = '— _None_';
    if (adminRows.length) {
      const resolved = await Promise.all(adminRows.map(async r => {
        const name = await fetchName(r.user_id);
        return `🛡️ **${name}** — \`${r.user_id}\``;
      }));
      adminLines = resolved.join('\n');
    }

    // Authorized users (excluding owner and admins)
    const adminIds = new Set(adminRows.map(r => r.user_id));
    const userRows = db.prepare('SELECT user_id FROM authorized_users').all()
      .filter(r => r.user_id !== OWNER_ID && !adminIds.has(r.user_id));
    let userLines = '— _None_';
    if (userRows.length) {
      const resolved = await Promise.all(userRows.map(async r => {
        const name = await fetchName(r.user_id);
        return `👤 **${name}** — \`${r.user_id}\``;
      }));
      userLines = resolved.join('\n');
    }

    const embed = new EmbedBuilder()
      .setTitle('Bot Ranks')
      .setColor(0x5865F2)
      .addFields(
        { name: '👑 Owner', value: ownerLine },
        { name: `🛡️ Admins (${adminRows.length})`, value: adminLines.slice(0, 1024) },
        { name: `👤 Authorized Users (${userRows.length})`, value: userLines.slice(0, 1024) }
      )
      .setFooter({ text: 'Only authorized users can use /askai' });

    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === 'hierarchy') {
    await interaction.deferReply();

    const attachment = interaction.options.getAttachment('rbx_file');
    const name = attachment.name || '';
    const lower = name.toLowerCase();

    if (!lower.endsWith('.rbxm') && !lower.endsWith('.rbxl')) {
      return interaction.editReply({ content: 'Please upload a valid `.rbxm` or `.rbxl` binary file.' });
    }

    if (attachment.size > 8 * 1024 * 1024) {
      return interaction.editReply({ content: 'File is too large. Please upload a file under 8 MB.' });
    }

    try {
      const res = await fetch(attachment.url);
      if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);

      const { typeNames, instanceTypes, parentOf, instanceNames, numInstances } = parseRBXM(buf);
      const { requiresScore, destructionScore, sandboxingScore } = calculateFlags(typeNames, instanceTypes);
      const flagsLine = `flags: requires (score: ${requiresScore})  destruction (score: ${destructionScore})  sandboxing (score: ${sandboxingScore})`;

      // Render with emojis (all lines up to MAX_LINES)
      const { lines: allLines, truncated: parseTruncated } = renderHierarchy(typeNames, instanceTypes, parentOf, instanceNames, emojiConfig);

      // Build inline preview: keep adding lines until we'd exceed 1900 chars
      const CHAR_LIMIT = 1900;
      const suffix = '\n' + flagsLine;
      let previewLines = [];
      let charCount = suffix.length + 4; // +4 for '\n...'
      let inlineTruncated = false;
      for (const ln of allLines) {
        if (charCount + ln.length + 1 > CHAR_LIMIT) { inlineTruncated = true; break; }
        previewLines.push(ln);
        charCount += ln.length + 1;
      }
      const previewText = previewLines.join('\n') + ((inlineTruncated || parseTruncated) ? '\n...' : '');
      const inlineMsg = previewText + suffix;

      return interaction.editReply({ content: inlineMsg });

    } catch (err) {
      const msg = err.message || 'Unknown error';
      return interaction.editReply({ content: `Failed to parse the file: ${msg}` });
    }
  }

});

keepAlive();
client.login(TOKEN).catch(err => {
    console.error('Failed to login:', err.message);
    process.exit(1);
});

