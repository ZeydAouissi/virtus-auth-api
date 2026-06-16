const express = require('express');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const axios = require('axios'); 

const app = express();

// إعداد بروتوكول CORS الصريح لامتصاص طلبات C++ ومنع الـ 404
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }
    next();
});

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

// ================= KEEP ALIVE (PREVENT SLEEP) =================
app.get("/api/ping", (req, res) => {
    return res.status(200).send("alive");
});

// سكربت ذكي يقوم بطلب السيرفر تلقائياً كل 5 دقائق لضمان عدم إغلاق الحاوية
setInterval(() => {
    axios.get('https://virtus-auth-api.up.railway.app/api/ping')
        .then(() => console.log('🔄 Keep-Alive: Ping Sent Successfully.'))
        .catch((err) => console.error('⚠️ Keep-Alive Failed:', err.message));
}, 5 * 60 * 1000);

// ================= HARD KILL SWITCH & UPDATE API =================
app.get('/api/update', (req, res) => {
    res.status(200).json({
        status: "banned", 
        latest_version: "v2.4.0-S",
        download_url: "https://discord.gg/vMCAY24n"
    });
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
    try {
        const { hwid } = req.body; 
        
        if (!hwid) return res.status(400).json({ error: "HWID is required" });

        let whitelist = await getWhitelist(); 

        if (whitelist[hwid]) {
            if (whitelist[hwid].status === "banned") {
                return res.status(200).json({ status: "banned", error: "This device is permanently banned." });
            }
            if (whitelist[hwid].status === "approved") {
                return res.status(200).json({ status: "approved", username: whitelist[hwid].username });
            }
        }

        return res.status(200).json({ status: "pending/not_found" });
    } catch (err) {
        console.error("Auth routing error:", err);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

// ================= INTERACTION HANDLER =================
client.on('interactionCreate', async (interaction) => {
    
    if (interaction.isButton() && interaction.customId === 'create_whitelist_ticket') {
        const modal = new ModalBuilder()
            .setCustomId('whitelist_modal')
            .setTitle('Device Registration');

        const hwidInput = new TextInputBuilder()
            .setCustomId('modal_hwid')
            .setLabel('Enter Your HWID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Paste your HWID here...')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(hwidInput));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'whitelist_modal') {
        await interaction.deferReply();

        const hwid = interaction.fields.getTextInputValue('modal_hwid');
        const discordUsername = interaction.user.username; 
        const discordId = interaction.user.id;             

        let whitelist = await getWhitelist();

        if (whitelist[hwid] && whitelist[hwid].status === "banned") {
            await interaction.editReply({ content: "❌ **Access Denied:** This HWID is permanently banned." });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
            return;
        }

        const isUserAlreadyRegistered = Object.entries(whitelist).some(
            ([existingHwid, data]) => existingHwid !== hwid && data.discordId === discordId && data.status === "approved"
        );

        if (isUserAlreadyRegistered) {
            await interaction.editReply({ content: "❌ **Registration Failed:** Discord account already linked." });
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
            content: `👋 Welcome <@${discordId}>,\n\n📩 **New Request!**\n👤 \`${discordUsername}\`\n🆔 \`${discordId}\`\n🔑 \`${hwid}\``,
            components: [row]
        });

        await interaction.editReply({ content: `✅ Ticket opened: <#${ticketChannel.id}>` });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
        return;
    }

    if (interaction.isButton()) {
        const [action, hwid] = interaction.customId.split('_');

        if (action === 'close') {
            if (interaction.user.id !== ADMIN_ID) return;
            await interaction.reply({ content: "Closing in 5 seconds..." });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            return;
        }

        if (['approve', 'deny', 'ban', 'revoke'].includes(action)) {
            if (interaction.user.id !== ADMIN_ID) return;

            let whitelist = await getWhitelist();
            if (!whitelist[hwid]) return;

            const targetUser = whitelist[hwid].username;
            const targetId = whitelist[hwid].discordId;

            if (action === 'approve') {
                whitelist[hwid].status = "approved";
                await saveWhitelist(whitelist);

                const revokeButton = new ButtonBuilder().setCustomId(`revoke_${hwid}`).setLabel('Revoke Access ❌').setStyle(ButtonStyle.Danger);
                const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);

                await interaction.update({
                    content: `✅ **Approved!**\n👤 \`${targetUser}\`\n🆔 \`${hwid}\``,
                    components: [new ActionRowBuilder().addComponents(revokeButton, closeButton)]
                });

                const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const currentUnixTime = Math.floor(Date.now() / 1000);
                    await logChannel.send({
                        content: `✅ **Access Granted**\n👤 <@${targetId}>\n🕒 <t:${currentUnixTime}:f>`
                    });
                }
            } 
            else if (action === 'deny') {
                delete whitelist[hwid];
                await saveWhitelist(whitelist);
                const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);
                await interaction.update({ content: `❌ **Denied**\n👤 \`${targetUser}\``, components: [new ActionRowBuilder().addComponents(closeButton)] });
            } 
            else if (action === 'revoke') {
                delete whitelist[hwid];
                await saveWhitelist(whitelist);
                const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);
                await interaction.update({ content: `🚫 **Revoked**\n👤 \`${targetUser}\``, components: [new ActionRowBuilder().addComponents(closeButton)] });
            } 
            else if (action === 'ban') {
                whitelist[hwid].status = "banned";
                await saveWhitelist(whitelist);
                const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);
                await interaction.update({ content: `🔨 **Banned**\n👤 \`${targetUser}\``, components: [new ActionRowBuilder().addComponents(closeButton)] });
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
            content: '📌 **Whitelist & Device Registration**\nClick below to register.',
            components: [row]
        });
        
        await message.delete().catch(() => {});
    }
});

// ================= DEBUG & LOGIN =================
client.on('ready', () => {
    console.log(`✅ تم تسجيل الدخول بنجاح كـ: ${client.user.tag}`);
});

client.on('error', console.error);
client.on('warn', console.warn);

console.log("-> جاري فحص الاتصال بشبكة ديسكورد (Discord API)...");

axios.get('https://discord.com/api/v10/gateway')
    .then(res => {
        console.log("✅ شبكة ديسكورد تعمل بشكل سليم من السيرفر. جاري تسجيل الدخول...");
        
        if (!process.env.BOT_TOKEN) {
            console.log("❌ خطأ: BOT_TOKEN مفقود من الإعدادات!");
        } else {
            client.login(process.env.BOT_TOKEN).catch(err => {
                console.error("❌ فشل تسجيل الدخول. السبب:");
                console.error(err);
            });
        }
    })
    .catch(err => {
        console.error("❌ خطأ حرج: السيرفر غير قادر على الوصول لديسكورد!");
        console.error(err.message);
    });

app.listen(process.env.PORT || 3000, () => {
    console.log('🌐 السيرفر يعمل بشكل صحيح واستقبال CORS مفعّل.');
});
