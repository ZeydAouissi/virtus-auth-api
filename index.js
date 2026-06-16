const express = require('express');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios'); 

const app = express();
app.use(express.json());

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

const DB_URL = "https://auth-aadf4-default-rtdb.firebaseio.com/whitelist.json";

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
    const { hwid, username, discordId } = req.body; 
    
    if (!hwid || !discordId) {
        return res.status(400).json({ error: "HWID & Discord ID required" });
    }

    let whitelist = await getWhitelist(); 

    // ✅ تحقق كامل
    if (
        whitelist[hwid] &&
        whitelist[hwid].status === "approved" &&
        whitelist[hwid].discordId === discordId
    ) {
        return res.json({ status: "approved" });
    }

    // ⏳ طلب جديد
    if (!whitelist[hwid]) {
        whitelist[hwid] = {
            username: username || "Unknown User",
            discordId: discordId,
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

            const row = new ActionRowBuilder().addComponents(approveButton, denyButton);

            await channel.send({
                content:
`📩 **New Auth Request!**
👤 User: \`${username}\`
💬 Discord ID: \`${discordId}\`
🆔 HWID: \`${hwid}\``,
                components: [row]
            });
        }
    }

    return res.json({ status: "pending" });
});

// ================= BUTTON HANDLER =================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.user.id !== '228898892425592832') {
        return interaction.reply({ content: "Unauthorized.", ephemeral: true });
    }

    const [action, hwid] = interaction.customId.split('_');
    let whitelist = await getWhitelist();

    if (!whitelist[hwid]) {
        return interaction.reply({ content: "Data not found.", ephemeral: true });
    }

    const username = whitelist[hwid].username || "Unknown User";
    const discordId = whitelist[hwid].discordId || "Unknown";

    // ✅ APPROVE
    if (action === 'approve') {

        whitelist[hwid].status = "approved";
        await saveWhitelist(whitelist);

        const revokeButton = new ButtonBuilder()
            .setCustomId(`revoke_${hwid}`)
            .setLabel('Revoke Access ❌')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(revokeButton);

        await interaction.update({
            content:
`✅ **Approved**
👤 User: \`${username}\`
💬 Discord: \`${discordId}\`
🆔 HWID: \`${hwid}\`
👮 By: ${interaction.user.username}`,
            components: [row]
        });
    }

    // ❌ DENY
    else if (action === 'deny') {

        delete whitelist[hwid];
        await saveWhitelist(whitelist);

        await interaction.update({
            content:
`❌ **Denied**
👤 User: \`${username}\`
💬 Discord: \`${discordId}\`
🆔 HWID: \`${hwid}\`
👮 By: ${interaction.user.username}`,
            components: []
        });
    }

    // 🔥 REVOKE
    else if (action === 'revoke') {

        delete whitelist[hwid];
        await saveWhitelist(whitelist);

        await interaction.update({
            content:
`🚫 **Access Revoked**
👤 User: \`${username}\`
💬 Discord: \`${discordId}\`
🆔 HWID: \`${hwid}\`
👮 By: ${interaction.user.username}`,
            components: []
        });
    }
});

client.on('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);

app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running.');
});
