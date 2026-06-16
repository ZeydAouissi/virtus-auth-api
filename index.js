const express = require('express');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios'); 

const app = express();
app.use(express.json());

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] 
});

const DB_URL = "https://auth-aadf4-default-rtdb.firebaseio.com/whitelist.json";

// 🔥 Your Discord User ID for Admin control
const ADMIN_ID = '228898892425592832'; 

// ================= KEEP ALIVE =================
app.get("/api/ping", (req, res) => {
    return res.status(200).send("alive");
});

// ================= DB FUNCTIONS =================
async function getWhitelist() {
    try {
        const response = await axios.get(DB_URL);
        return response.data || {}; 
    } catch (error) {
        console.error("Error fetching whitelist:", error);
        return {};
    }
}

async function saveWhitelist(whitelistObj) {
    try {
        await axios.put(DB_URL, whitelistObj);
    } catch (error) {
        console.error("Error saving whitelist:", error);
    }
}

// ================= API AUTH =================
app.post('/api/auth', async (req, res) => { 
    const { hwid, username } = req.body; 
    
    if (!hwid || !username) {
        return res.status(400).json({ error: "HWID and Username are required" });
    }

    let whitelist = await getWhitelist(); 

    // 1. Check if HWID is banned
    if (whitelist[hwid] && whitelist[hwid].status === "banned") {
        return res.status(403).json({ status: "banned", error: "This device is permanently banned." });
    }

    // 2. Prevent using an already taken username by another approved device (No auto-ban)
    const isUsernameTaken = Object.entries(whitelist).some(
        ([existingHwid, data]) => existingHwid !== hwid && data.username === username && data.status === "approved"
    );

    if (isUsernameTaken) {
        return res.status(400).json({ error: "This username is already in use by another approved device. Please choose a different name." });
    }

    // 3. Check if HWID is already approved
    if (whitelist[hwid] && whitelist[hwid].status === "approved") {
        return res.json({ status: "approved" });
    }

    // 4. Send new request to Discord if pending or previously denied
    if (!whitelist[hwid] || whitelist[hwid].status === "denied") {
        whitelist[hwid] = {
            username: username,
            status: "pending"
        };

        await saveWhitelist(whitelist); 

        const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);

        if (channel) {
            const approveButton = new ButtonBuilder()
                .setCustomId(`approve_${hwid}`)
                .setLabel('Approve ✅')
                .setStyle(ButtonStyle.Success);

            const denyButton = new ButtonBuilder()
                .setCustomId(`deny_${hwid}`)
                .setLabel('Deny ❌')
                .setStyle(ButtonStyle.Danger);

            const banButton = new ButtonBuilder()
                .setCustomId(`ban_${hwid}`)
                .setLabel('Ban HWID 🔨')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(approveButton, denyButton, banButton);

            await channel.send({
                content: `📩 **New Auth Request!**\n👤 User: \`${username}\`\n🆔 HWID: \`${hwid}\``,
                components: [row]
            });
        }
    }

    return res.json({ status: "pending" });
});

// ================= BUTTON HANDLER =================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // 🛑 Clear, descriptive English message instead of just "Unauthorized"
    if (interaction.user.id !== ADMIN_ID) {
        return interaction.reply({ 
            content: "❌ **Access Denied:** You do not have permission to use this button. These controls are strictly restricted to the authorized administrator.", 
            ephemeral: true 
        });
    }

    const [action, hwid] = interaction.customId.split('_');
    let whitelist = await getWhitelist();

    if (!whitelist[hwid]) {
        return interaction.reply({ content: "⚠️ Data for this user could not be found in the database.", ephemeral: true });
    }

    const username = whitelist[hwid].username || "Unknown User";

    // ✅ APPROVE
    if (action === 'approve') {
        whitelist[hwid].status = "approved";
        await saveWhitelist(whitelist);

        const revokeButton = new ButtonBuilder()
            .setCustomId(`revoke_${hwid}`)
            .setLabel('Revoke Access ❌')
            .setStyle(ButtonStyle.Danger);

        const banButton = new ButtonBuilder()
            .setCustomId(`ban_${hwid}`)
            .setLabel('Ban HWID 🔨')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(revokeButton, banButton);

        await interaction.update({
            content: `✅ **Approved**\n👤 User: \`${username}\`\n🆔 HWID: \`${hwid}\`\n👮 By: <@${interaction.user.id}>`,
            components: [row]
        });
    }

    // ❌ DENY
    else if (action === 'deny') {
        delete whitelist[hwid]; 
        await saveWhitelist(whitelist);

        await interaction.update({
            content: `❌ **Denied**\n👤 User: \`${username}\`\n🆔 HWID: \`${hwid}\`\n👮 By: <@${interaction.user.id}>`,
            components: []
        });
    }

    // 🚫 REVOKE
    else if (action === 'revoke') {
        delete whitelist[hwid];
        await saveWhitelist(whitelist);

        await interaction.update({
            content: `🚫 **Access Revoked**\n👤 User: \`${username}\`\n🆔 HWID: \`${hwid}\`\n👮 By: <@${interaction.user.id}>`,
            components: []
        });
    }

    // 🔨 BAN
    else if (action === 'ban') {
        whitelist[hwid].status = "banned"; 
        await saveWhitelist(whitelist);

        await interaction.update({
            content: `🔨 **HWID Banned**\n👤 User: \`${username}\`\n🆔 HWID: \`${hwid}\`\n👮 By: <@${interaction.user.id}>`,
            components: []
        });
    }
});

// ================= BOT READY =================
client.on('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);

// ================= SERVER =================
app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running.');
});
