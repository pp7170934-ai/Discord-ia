const keepAlive = require('./keep_alive');
keepAlive();

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const MARIZMA_BASE = 'https://maple-api.marizma.games';
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const MARIZMA_API_KEY = process.env.MARIZMA_API_KEY;

const commands = [
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a Roblox user via the Maple API')
    .addIntegerOption(option => option.setName('robloxuserid').setDescription('The Roblox user ID to ban').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a Roblox user via the Maple API')
    .addIntegerOption(option => option.setName('robloxuserid').setDescription('The Roblox user ID to unban').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('banlist')
    .setDescription('Show all currently banned Roblox user IDs')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a Roblox player from the server')
    .addIntegerOption(option => option.setName('robloxuserid').setDescription('The Roblox user ID to kick').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Optional reason for the kick'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send an announcement to the Roblox server')
    .addStringOption(option => option.setName('message').setDescription('The message to announce').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('shutdown')
    .setDescription('Shut down the Roblox server (owner only)')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show live Roblox server information')
    .toJSON(),
];

async function callApi(path, body) {
  const res = await fetch(`${MARIZMA_BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Api-Key': MARIZMA_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { res, data: await res.json() };
}

async function startBot() {
  if (!TOKEN || !MARIZMA_API_KEY) return;

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const clientId = (await rest.get(Routes.currentApplication())).id;
  await rest.put(Routes.applicationCommands(clientId), { body: commands });

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ban') {
      await interaction.deferReply();
      const id = interaction.options.getInteger('robloxuserid', true);
      const { res, data } = await callApi('/v1/server/banplayer', { Banned: true, UserId: id });
      return interaction.editReply(res.ok && data.success ? `✅ Successfully banned Roblox user \`${id}\`.` : `❌ Failed to ban user: ${data?.data?.message ?? `HTTP ${res.status}`}`);
    }

    if (interaction.commandName === 'unban') {
      await interaction.deferReply();
      const id = interaction.options.getInteger('robloxuserid', true);
      const { res, data } = await callApi('/v1/server/banplayer', { Banned: false, UserId: id });
      return interaction.editReply(res.ok && data.success ? `✅ Successfully unbanned Roblox user \`${id}\`.` : `❌ Failed to unban user: ${data?.data?.message ?? `HTTP ${res.status}`}`);
    }

    if (interaction.commandName === 'banlist') {
      await interaction.deferReply();
      const [bansRes, serverRes] = await Promise.all([
        fetch(`${MARIZMA_BASE}/v1/server/bans`, { headers: { 'X-Api-Key': MARIZMA_API_KEY } }),
        fetch(`${MARIZMA_BASE}/v1/server`, { headers: { 'X-Api-Key': MARIZMA_API_KEY } }),
      ]);
      const bansData = await bansRes.json();
      const serverData = await serverRes.json();
      const bans = bansData?.data?.Bans ?? [];
      const adminIds = new Set([...(serverData?.data?.Admins ?? []), ...(serverData?.data?.HeadAdmins ?? []), serverData?.data?.Owner].filter(Boolean));
      const lines = bans.length ? bans.map(id => `\`${id}\`${adminIds.has(id) ? ' (admin)' : ''}`) : ['No users are currently banned.'];
      const embed = new EmbedBuilder().setTitle(`🔨 Ban List (${bans.length} users)`).setColor(0xED4245).setDescription(lines.slice(0, 20).join('\n'));
      return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'kick') {
      await interaction.deferReply();
      const id = interaction.options.getInteger('robloxuserid', true);
      const reason = interaction.options.getString('reason') || '';
      const { res, data } = await callApi('/v1/server/moderation/kick', { UserId: id, ModerationReason: reason });
      return interaction.editReply(res.ok && data.success ? `✅ Successfully kicked Roblox user \`${id}\`.` : `❌ Failed to kick user: ${data?.data?.message ?? `HTTP ${res.status}`}`);
    }

    if (interaction.commandName === 'announce') {
      await interaction.deferReply();
      const message = interaction.options.getString('message', true);
      const { res, data } = await callApi('/v1/server/announce', { message });
      return interaction.editReply(res.ok && data.success ? `📢 Announcement sent.` : `❌ Failed to send announcement: ${data?.data?.message ?? `HTTP ${res.status}`}`);
    }

    if (interaction.commandName === 'shutdown') {
      await interaction.deferReply();
      const { res, data } = await callApi('/v1/server/shutdown');
      return interaction.editReply(res.ok && data.success ? `⚠️ Server shutdown initiated.` : `❌ Failed to shut down server: ${data?.data?.message ?? `HTTP ${res.status}`}`);
    }

    if (interaction.commandName === 'serverinfo') {
      await interaction.deferReply();
      const res = await fetch(`${MARIZMA_BASE}/v1/server`, { headers: { 'X-Api-Key': MARIZMA_API_KEY } });
      const data = await res.json();
      const info = data?.data || {};
      const players = info.Players || [];
      const lines = players.length ? players.slice(0, 20).map(p => {
        const id = p.UserId ?? p.userId ?? p.Id ?? p.id ?? p;
        const name = p.Username ?? p.username ?? p.Name ?? p.name ?? '';
        return name ? `\`${id}\` ${name}` : `\`${id}\``;
      }).join('\n') : 'None';
      const embed = new EmbedBuilder().setTitle('🖥️ Server Info').setColor(0x5865F2).addFields(
        { name: 'Server Name', value: String(info.ServerName || 'Unknown'), inline: false },
        { name: 'Code', value: String(info.Code || 'Unknown'), inline: true },
        { name: 'Owner', value: info.Owner ? `\`${info.Owner}\`` : 'Unknown', inline: true },
        { name: 'Players', value: String((info.PlayerCount ?? 0) + '/' + (info.MaxPlayers ?? 0)), inline: true },
        { name: 'Players (IDs + Usernames)', value: lines, inline: false },
      );
      return interaction.editReply({ embeds: [embed] });
    }
  });

  client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));
  await client.login(TOKEN);
}

startBot().catch(err => console.error(err));
