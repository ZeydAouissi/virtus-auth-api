const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios'); // تم التغيير من fs إلى axios

const app = express();
app.use(express.json());

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

// رابط الفايربيز الخاص بك
const DB_URL = "https://auth-aadf4-default-rtdb.firebaseio.com/whitelist.json";
let pendingRequests = new Map(); 

// دالة جلب الوايت ليست من الفايربيز
async function getWhitelist() {
    try {
        const response = await axios.get(DB_URL);
        return response.data || []; // إذا كانت القاعدة فارغة ترجع مصفوفة فارغة
    } catch (error) {
        console.error("Error fetching whitelist:", error);
        return [];
    }
}

// دالة حفظ الوايت ليست في الفايربيز
async function saveWhitelist(whitelistArray) {
    try {
        await axios.put(DB_URL, whitelistArray);
    } catch (error) {
        console.error("Error saving whitelist:", error);
    }
}

// الـ Route الخاص بفحص الـ HWID من البرنامج
app.post('/api/auth', async (req, res) => { // تم إضافة async هنا
    const { hwid, username } = req.body; 
    
    if (!hwid) return res.status(400).json({ error: "HWID is required" });

    const whitelist = await getWhitelist(); // جلب البيانات المباشرة من الفايربيز

    if (whitelist.includes(hwid)) {
        return res.json({ status: "approved" });
    }

    if (!pendingRequests.has(hwid)) {
        pendingRequests.set(hwid, username || "Unknown");
        const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
        if (channel) {
            channel.send(`**New Auth Request!**\nUser: \`${username || "Unknown"}\`\nHWID: \`${hwid}\`\nTo approve, type: \`!add ${hwid}\``);
        }
    }
    
    return res.json({ status: "pending" });
});

// أوامر الديسكورد للتفعيل والإلغاء
client.on('messageCreate', async (message) => { // تم إضافة async هنا
    if (message.author.bot || message.author.id !== '228898892425592832') return;
    if (message.channel.id !== process.env.DISCORD_CHANNEL_ID) return;

    if (message.content.startsWith('!add ')) {
        const hwid = message.content.split(' ')[1];
        if (!hwid) return;

        let whitelist = await getWhitelist(); // جلب القائمة المحدثة

        if (pendingRequests.has(hwid)) {
            whitelist.push(hwid);
            pendingRequests.delete(hwid);
            await saveWhitelist(whitelist); // حفظ التحديث في الفايربيز
            message.reply(`✅ Access granted for HWID: \`${hwid}\``);
        } else if (whitelist.includes(hwid)) {
            message.reply(`⚠️ HWID \`${hwid}\` is already approved.`);
        } else {
            message.reply(`❌ No pending request found for HWID: \`${hwid}\`.`);
        }
    }

    if (message.content.startsWith('!remove ')) {
        const hwid = message.content.split(' ')[1];
        if (!hwid) return;

        let whitelist = await getWhitelist(); // جلب القائمة المحدثة

        if (whitelist.includes(hwid)) {
            whitelist = whitelist.filter(id => id !== hwid);
            await saveWhitelist(whitelist); // حفظ التحديث بعد الحذف
            message.reply(`❌ Access revoked for HWID: \`${hwid}\``);
        } else {
            message.reply(`⚠️ HWID \`${hwid}\` not found in the whitelist.`);
        }
    }
});

client.login(process.env.BOT_TOKEN);
app.listen(process.env.PORT || 3000);
