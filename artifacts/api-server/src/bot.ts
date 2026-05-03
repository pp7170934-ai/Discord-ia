import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";
import { logger } from "./lib/logger";

const MARIZMA_BASE = "https://maple-api.marizma.games";

const commands = [
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a Roblox user via the Maple API")
    .addIntegerOption((option) =>
      option
        .setName("robloxuserid")
        .setDescription("The Roblox user ID to ban")
        .setRequired(true),
    )
    .toJSON(),
];

async function handleBan(interaction: ChatInputCommandInteraction) {
  const userId = interaction.options.getInteger("robloxuserid", true);
  const apiKey = process.env["MARIZMA_API_KEY"];

  await interaction.deferReply();

  try {
    const res = await fetch(`${MARIZMA_BASE}/v1/server/banplayer`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Banned: true, UserId: userId }),
    });

    const data = (await res.json()) as {
      success: boolean;
      data?: { message?: string };
    };

    if (res.ok && data.success) {
      await interaction.editReply(
        `✅ Successfully banned Roblox user \`${userId}\`.`,
      );
    } else {
      const msg = data?.data?.message ?? `HTTP ${res.status}`;
      await interaction.editReply(`❌ Failed to ban user: ${msg}`);
    }
  } catch (err) {
    logger.error({ err }, "Error calling Marizma ban API");
    await interaction.editReply(
      "❌ An error occurred while trying to ban the user.",
    );
  }
}

export async function startBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const apiKey = process.env["MARIZMA_API_KEY"];

  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set — Discord bot will not start");
    return;
  }
  if (!apiKey) {
    logger.warn("MARIZMA_API_KEY not set — Discord bot will not start");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(token);

  const appInfo = (await rest.get(Routes.currentApplication())) as {
    id: string;
  };
  const clientId = appInfo.id;

  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  logger.info("Registered Discord slash commands globally");

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on("interactionCreate", async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "ban") {
      await handleBan(interaction);
    }
  });

  client.once("ready", () => {
    logger.info({ tag: client.user?.tag }, "Discord bot ready");
  });

  await client.login(token);
}
