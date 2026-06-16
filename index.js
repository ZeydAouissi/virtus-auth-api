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

// Handling HWID Authentication requests from C++
app.post('/api/auth', async (req, res) => { 
    const { hwid, username } = req.body; 
    
    if (!hwid) {
        return res.status(400).json({ error: "HWID is required" });
    }

    let whitelist = await getWhitelist(); 

    if (whitelist[hwid] && whitelist[hwid].status === "approved") {
        return res.json({ status: "approved" });
    }

    if (!whitelist[hwid]) {
        whitelist[hwid] = {
            username: username || "Unknown User",
            status: "pending"
        };
        await saveWhitelist(whitelist); 

        const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
        if (channel) {
            // Creating Clickable Buttons
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
                content: `**New Auth Request!**\nUser: \`${username || "Unknown User"}\`\nHWID: \`${hwid}\``,
                components: [row]
            });
        }
    }
    
    return res.json({ status: "pending" });
});

// Handling Button Interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    // Restriction to your Discord Admin ID
    if (interaction.user.id !== '228898892425592832') {
        return interaction.reply({ content: "You are not authorized to use these buttons.", ephemeral: true });
    }

    const [action, hwid] = interaction.customId.split('_');
    let whitelist = await getWhitelist();

    if (action === 'approve') {
        if (whitelist[hwid]) {
            whitelist[hwid].status = "approved";
            await saveWhitelist(whitelist);
            
            // Update message to show it's approved and remove buttons
            await interaction.update({
                content: `✅ **Approved Successfully!**\nUser: **${whitelist[hwid].username}**\nHWID: \`${hwid}\`\n*Approved by ${interaction.user.username}*`,
                components: []
            });
        } else {
            await interaction.reply({ content: "HWID data not found in Firebase.", ephemeral: true });
        }
    }

    if (action === 'deny') {
        if (whitelist[hwid]) {
            delete whitelist[hwid];
            await saveWhitelist(whitelist);
            
            // Update message to show it's denied/removed and remove buttons
            await interaction.update({
                content: `❌ **Request Denied & Removed!**\nHWID: \`${hwid}\`\n*Denied by ${interaction.user.username}*`,
                components: []
            });
        } else {
            await interaction.reply({ content: "HWID data not found or already deleted.", ephemeral: true });
        }
    }
});

client.on('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);
app.listen(process.env.PORT || 3000, () => console.log('Server is running with production Button-Auth logic'));
