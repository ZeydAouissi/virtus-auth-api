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
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID; // أيدي قسم التيكيتات

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
    
    // 1️⃣ عند الضغط على زر إنشاء التيكيت
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

    // 2️⃣ عند إرسال النافذة (Modal Submit)
    if (interaction.isModalSubmit() && interaction.customId === 'whitelist_modal') {
        // تم إلغاء ephemeral لتظهر الرسالة للجميع ويتمكن البوت من حذفها تلقائياً
        await interaction.deferReply({ ephemeral: false });

        const hwid = interaction.fields.getTextInputValue('modal_hwid');
        const discordUsername = interaction.user.username; 
        const discordId = interaction.user.id;             

        let whitelist = await getWhitelist();

        // أ. فحص إذا كان الجهاز محظوراً
        if (whitelist[hwid] && whitelist[hwid].status === "banned") {
            await interaction.editReply({ content: "❌ **Access Denied:** This HWID is permanently banned from the system." });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
            return;
        }

        // ب. منع حساب الديسكورد من التسجيل لجهاز آخر
        const isUserAlreadyRegistered = Object.entries(whitelist).some(
            ([existingHwid, data]) => existingHwid !== hwid && data.discordId === discordId && data.status === "approved"
        );

        if (isUserAlreadyRegistered) {
            await interaction.editReply({ content: "❌ **Registration Failed:** Your Discord account is already linked to another approved device." });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
            return;
        }

        // ج. إنشاء روم التيكيت الخاصة بالعضو
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

        // حفظ البيانات مؤقتاً بحالة معلق
        whitelist[hwid] = {
            username: discordUsername,
            discordId: discordId,
            status: "pending"
        };
        await saveWhitelist(whitelist);

        // أزرار التحكم للإدارة داخل التيكيت مباشرة
        const approveButton = new ButtonBuilder().setCustomId(`approve_${hwid}`).setLabel('Approve ✅').setStyle(ButtonStyle.Success);
        const denyButton = new ButtonBuilder().setCustomId(`deny_${hwid}`).setLabel('Deny ❌').setStyle(ButtonStyle.Danger);
        const banButton = new ButtonBuilder().setCustomId(`ban_${hwid}`).setLabel('Ban HWID 🔨').setStyle(ButtonStyle.Secondary);
        const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(approveButton, denyButton, banButton, closeButton);

        await ticketChannel.send({
            content: `👋 Welcome <@${discordId}>,\n\n📩 **New Whitelist Request Submitted!**\n👤 **Discord Name (Auto):** \`${discordUsername}\`\n🆔 **Discord ID:** \`${discordId}\`\n🔑 **HWID:** \`${hwid}\`\n\n*The administrator will review your device details shortly.*`,
            components: [row]
        });

        // الرد في الروم الرئيسية بحذفه بعد 10 ثوانٍ
        await interaction.editReply({ content: `✅ Your ticket has been opened here: <#${ticketChannel.id}>` });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
