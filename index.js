const express = require('express');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder
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

// 🔴 إعدادات حماية الإصدارات (Kill Switch)
const CURRENT_VERSION = "v2.4.0-S"; // قم بتغيير هذا الرقم عند إصدار نسخة جديدة لإيقاف القديمة
const DOWNLOAD_URL = "https://discord.gg/B5Rmg9PX5Y"; // رابط تحميل النسخة الجديدة

// ================= KEEP ALIVE (PREVENT SLEEP) =================
app.get("/api/ping", (req, res) => {
    return res.status(200).send("alive");
});

// سكربت ذكي يقوم بطلب السيرفر تلقائياً كل 5 دقائق لضمان عدم إغلاق الحاوية
setInterval(() => {
    axios.get('https://virtus-auth-api-production.up.railway.app/api/ping')
        .then(() => console.log('🔄 Keep-Alive: Ping Sent Successfully.'))
        .catch((err) => console.error('⚠️ Keep-Alive Failed:', err.message));
}, 5 * 60 * 1000);

// ================= HARD KILL SWITCH & UPDATE API =================
app.get('/api/update', (req, res) => {
    res.status(200).json({
        status: "approved", 
        latest_version: CURRENT_VERSION,
        download_url: DOWNLOAD_URL
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
        const { hwid, version } = req.body; 
        
        if (!hwid) return res.status(400).json({ error: "HWID is required" });

        // 🔴 التحقق من أن المستخدم يمتلك أحدث نسخة
        if (!version || version !== CURRENT_VERSION) {
            return res.status(200).json({ 
                status: "outdated", 
                error: "This version is outdated. Please download the new version.",
                latest_version: CURRENT_VERSION,
                download_url: DOWNLOAD_URL
            });
        }

        let whitelist = await getWhitelist(); 

        if (whitelist[hwid]) {
            if (whitelist[hwid].status === "banned") {
                return res.status(200).json({ status: "banned", error: "This device is permanently banned." });
            }

            if (whitelist[hwid].status === "approved") {
                // التحقق من الوقت إذا كان لديه وقت انتهاء
                if (whitelist[hwid].expiresAt && Date.now() > whitelist[hwid].expiresAt) {
                    whitelist[hwid].status = "expired";
                    await saveWhitelist(whitelist);
                    return res.status(200).json({ status: "expired", error: "Your subscription has expired. Please renew." });
                }
                
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

        // إنشاء قائمة اختيار الوقت (الكومبو)
        const timeSelect = new StringSelectMenuBuilder()
            .setCustomId(`approve_time_${hwid}`)
            .setPlaceholder('✅ Approve & Select Duration')
            .addOptions([
                { label: '1 Hour', description: 'Approve for 1 Hour', value: '1h' },
                { label: '24 Hours', description: 'Approve for 24 Hours', value: '24h' },
                { label: '1 Week', description: 'Approve for 7 Days', value: '1w' },
                { label: '1 Month', description: 'Approve for 30 Days', value: '1m' },
                { label: 'Lifetime', description: 'Permanent Access', value: 'lifetime' }
            ]);

        // أزرار الرفض والبان والإغلاق
        const denyButton = new ButtonBuilder().setCustomId(`deny_${hwid}`).setLabel('Deny ❌').setStyle(ButtonStyle.Danger);
        const banButton = new ButtonBuilder().setCustomId(`ban_${hwid}`).setLabel('Ban HWID 🔨').setStyle(ButtonStyle.Secondary);
        const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);

        const selectRow = new ActionRowBuilder().addComponents(timeSelect);
        const buttonsRow = new ActionRowBuilder().addComponents(denyButton, banButton, closeButton);

        await ticketChannel.send({
            content: `👋 Welcome <@${discordId}>,\n\n📩 **New Request!**\n👤 \`${discordUsername}\`\n🆔 \`${discordId}\`\n🔑 \`${hwid}\`\n\n⚠️ **Admins:** Please select approval duration from the menu below.`,
            components: [selectRow, buttonsRow]
        });

        await interaction.editReply({ content: `✅ Ticket opened: <#${ticketChannel.id}>` });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
        return;
    }

    // ================= HANDLER FOR SELECT MENU (APPROVAL COMBO) =================
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('approve_time_')) {
        if (interaction.user.id !== ADMIN_ID) {
            return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
        }

        const hwid = interaction.customId.replace('approve_time_', '');
        const duration = interaction.values[0];

        let whitelist = await getWhitelist();
        if (!whitelist[hwid]) return interaction.reply({ content: '❌ HWID not found.', ephemeral: true });

        const targetUser = whitelist[hwid].username;
        const targetId = whitelist[hwid].discordId;

        // حساب وقت الانتهاء بناءً على الاختيار
        let expiresAt = null;
        const now = Date.now();
        let durationText = "Lifetime";

        if (duration === '1h') { expiresAt = now + (3600 * 1000); durationText = "1 Hour"; }
        else if (duration === '24h') { expiresAt = now + (24 * 3600 * 1000); durationText = "24 Hours"; }
        else if (duration === '1w') { expiresAt = now + (7 * 24 * 3600 * 1000); durationText = "1 Week"; }
        else if (duration === '1m') { expiresAt = now + (30 * 24 * 3600 * 1000); durationText = "1 Month"; }

        // تحديث قاعدة البيانات
        whitelist[hwid].status = "approved";
        whitelist[hwid].expiresAt = expiresAt; 
        await saveWhitelist(whitelist);

        const revokeButton = new ButtonBuilder().setCustomId(`revoke_${hwid}`).setLabel('Revoke Access ❌').setStyle(ButtonStyle.Danger);
        const closeButton = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Primary);

        await interaction.update({
            content: `✅ **Approved!**\n👤 \`${targetUser}\`\n🆔 \`${hwid}\`\n⏳ **Duration:** ${durationText}`,
            components: [new ActionRowBuilder().addComponents(revokeButton, closeButton)]
        });

        // إرسال سجل التفعيل
        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const currentUnixTime = Math.floor(now / 1000);
            await logChannel.send({
                content: `✅ **Access Granted**\n👤 <@${targetId}>\n⏳ **Duration:** ${durationText}\n🕒 <t:${currentUnixTime}:f>`
            });
        }
        return;
    }

    // ================= HANDLER FOR BUTTONS (DENY, BAN, REVOKE, CLOSE) =================
    if (interaction.isButton()) {
        const [action, hwid] = interaction.customId.split('_');

        if (action === 'close') {
            if (interaction.user.id !== ADMIN_ID) return;
            await interaction.reply({ content: "Closing in 5 seconds..." });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            return;
        }

        if (['deny', 'ban', 'revoke'].includes(action)) {
            if (interaction.user.id !== ADMIN_ID) return;

            let whitelist = await getWhitelist();
            if (!whitelist[hwid]) return;

            const targetUser = whitelist[hwid].username;

            if (action === 'deny') {
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
    console.log(`🌐 السيرفر يعمل بشكل صحيح والإصدار المطلوب حالياً هو: ${CURRENT_VERSION}`);
});
