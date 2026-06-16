const express = require('express');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
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

// ================= CONFIGURATION =================
const ADMIN_ID = process.env.ADMIN_ID || '228898892425592832'; 
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID; 
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1516417216675844116'; 

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

// ================= API AUTH (For Your Game/App) =================
app.post('/api/auth', async (req, res) => { 
    const { hwid } = req.body; 
    
    if (!hwid) return res.status(400).json({ error: "HWID is required" });

    let whitelist = await getWhitelist(); 

    if (whitelist[hwid]) {
        if (whitelist[hwid].status === "banned") {
            return res.status(403).json({ status: "banned", error: "This device is permanently banned." });
        }
        if (whitelist[hwid].status === "approved") {
            return res.json({ status: "approved", username: whitelist[hwid].username });
        }
    }

    return res.json({ status: "pending/not_found" });
});

// ================= INTERACTION HANDLER =================
client.on('interactionCreate', async (interaction) => {
    
    if (interaction.isButton() && interaction.customId === 'create_whitelist_ticket') {
        const modal = new ModalBuilder()
            .setCustomId('whitelist_modal')
            .setTitle('Device Registration');

        const hwidInput = new TextInputBuilder()
            .setCustomId('modal_hwid')
            .setLabel('Enter Your HWID / كود الجهاز')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Paste your HWID here...')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(hwidInput));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'whitelist_modal') {
        await interaction.deferReply({ ephemeral: false });

        const hwid = interaction.fields.getTextInputValue('modal_hwid');
        const discordUsername = interaction.user.username; 
        const discordId = interaction.user.id;             

        let whitelist = await getWhitelist();

        if (whitelist[hwid] && whitelist[hwid].status === "banned") {
            await interaction.editReply({ content: "❌ **Access Denied:** This HWID is permanently banned from the system." });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
            return;
        }

        const isUserAlreadyRegistered = Object.entries(whitelist).some(
            ([existingHwid, data]) => existingHwid !== hwid && data.discordId === discordId && data.status === "approved"
        );

        if (isUserAlreadyRegistered) {
            await interaction.editReply({ content: "❌ **Registration Failed:** Your Discord account is already linked to another approved device." });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
            return;
        }

        const guild = interaction.guild;
        const ticketChannel = await guild.channels.create({
            name: `ticket-${discordUsername}`,
            type: ChannelType.GuildText,
            parent: TICKET_CATEGORY_ID || null,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: ADMIN_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ]
        });

        whitelist[hwid] = {
            username: discordUsername,
            discordId: discordId,
            status: "pending"
        };
        await saveWhitelist(whitelist);

        const approveButton = new ButtonBuilder().setCustomId(`approve_${hwid}`).setLabel('Approve ✅').setStyle(ButtonStyle.Success);
        const denyButton = new ButtonBuilder().setCustomId(`deny_${hwid}`).setLabel('Deny ❌').setStyle(ButtonStyle.Danger);
        const banButton = new ButtonBuilder().setCustomId(`ban_${hwid}`).setLabel('Ban HWID 🔨').setStyle(ButtonStyle.Secondary);
        const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(approveButton, denyButton, banButton, closeButton);

        await ticketChannel.send({
            content: `👋 Welcome <@${discordId}>,\n\n📩 **New Whitelist Request Submitted!**\n👤 **Discord Name (Auto):** \`${discordUsername}\`\n🆔 **Discord ID:** \`${discordId}\`\n🔑 **HWID:** \`${hwid}\`\n\n*The administrator will review your device details shortly.*`,
            components: [row]
        });

        await interaction.editReply({ content: `✅ Your ticket has been opened here: <#${ticketChannel.id}>` });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
        return;
    }

    if (interaction.isButton()) {
        const [action, hwid] = interaction.customId.split('_');

        if (action === 'close') {
            if (interaction.user.id !== ADMIN_ID) {
                await interaction.reply({ content: "❌ Strictly restricted to administrators." });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
                return;
            }
            await interaction.reply({ content: "This ticket will be deleted in 5 seconds..." });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            return;
        }

        if (['approve', 'deny', 'ban', 'revoke'].includes(action)) {
            if (interaction.user.id !== ADMIN_ID) {
                await interaction.reply({ content: "❌ **Access Denied:** Admin privileges required." });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
                return;
            }

            let whitelist = await getWhitelist();
            if (!whitelist[hwid]) {
                await interaction.reply({ content: "⚠️ User data not found in database." });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
                return;
            }

            const targetUser = whitelist[hwid].username;
            const targetId = whitelist[hwid].discordId;

            if (action === 'approve') {
                whitelist[hwid].status = "approved";
                await saveWhitelist(whitelist);

                const revokeButton = new ButtonBuilder().setCustomId(`revoke_${hwid}`).setLabel('Revoke Access ❌').setStyle(ButtonStyle.Danger);
                const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);

                await interaction.update({
                    content: `✅ **Approved Successfully!**\n👤 User: \`${targetUser}\`\n🆔 HWID: \`${hwid}\`\n👮 Approved By: <@${interaction.user.id}>`,
                    components: [new ActionRowBuilder().addComponents(revokeButton, closeButton)]
                });

                // إرسال الإشعار الاحترافي باللغة الإنجليزية مع التوقيت
                const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const currentUnixTime = Math.floor(Date.now() / 1000);
                    await logChannel.send({
                        content: `✅ **Access Granted**\n👤 **User:** <@${targetId}>\n📝 **Status:** Whitelisted Successfully. Welcome to VIRTUS.\n🕒 **Activated At:** <t:${currentUnixTime}:f>`
                    });
                }
            } 
            
            else if (action === 'deny') {
                delete whitelist[hwid];
                await saveWhitelist(whitelist);
                
                const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);
                await interaction.update({
                    content: `❌ **Request Denied**\n👤 User: \`${targetUser}\`\n🆔 HWID: \`${hwid}\`\n👮 Denied By: <@${interaction.user.id}>`,
                    components: [new ActionRowBuilder().addComponents(closeButton)]
                });
            } 
            
            else if (action === 'revoke') {
                delete whitelist[hwid];
                await saveWhitelist(whitelist);

                const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);
                await interaction.update({
                    content: `🚫 **Access Revoked**\n👤 User: \`${targetUser}\`\n🆔 HWID: \`${hwid}\`\n👮 Revoked By: <@${interaction.user.id}>`,
                    components: [new ActionRowBuilder().addComponents(closeButton)]
                });
            } 
            
            else if (action === 'ban') {
                whitelist[hwid].status = "banned";
                await saveWhitelist(whitelist);

                const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);
                await interaction.update({
                    content: `🔨 **HWID Permanently Banned**\n👤 User: \`${targetUser}\`\n🆔 HWID: \`${hwid}\`\n👮 Banned By: <@${interaction.user.id}>`,
                    components: [new ActionRowBuilder().addComponents(closeButton)]
                });
            }
        }
    }
});

// ================= SETUP COMMAND =================
client.on('messageCreate', async (message) => {
    if (message.content === '!setup' && message.author.id === ADMIN_ID) {
        const setupButton = new ButtonBuilder()
            .setCustomId('create_whitelist_ticket')
            .setLabel('Create Ticket 🎫')
            .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(setupButton);

        await message.channel.send({
            content: '📌 **Whitelist & Device Registration**\n\nClick the button below to open a ticket and automatically link your Discord profile with your device HWID.',
            components: [row]
        });
        
        await message.delete().catch(() => {});
    }
});

client.on('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN).catch(err => {
    console.error("❌ فشل تسجيل الدخول للديسكورد! تأكد من التوكن أو الصلاحيات:");
    console.error(err);
});
app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running.');
});
