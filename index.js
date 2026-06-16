const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios'); 

const app = express();
app.use(express.json());

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

// رابط الفايربيز الرئيسي
const DB_URL = "https://auth-aadf4-default-rtdb.firebaseio.com/whitelist.json";
let pendingRequests = new Map(); 

// دالة جلب الوايت ليست من الفايربيز كـ Object لتفادي كراشات المصفوفات
async function getWhitelist() {
    try {
        const response = await axios.get(DB_URL);
        return response.data || {}; // إرجاع كائن فارغ {} إذا كانت القاعدة فارغة
    } catch (error) {
        console.error("Error fetching whitelist:", error);
        return {};
    }
}

// دالة حفظ الوايت ليست في الفايربيز
async function saveWhitelist(whitelistObj) {
    try {
        await axios.put(DB_URL, whitelistObj);
    } catch (error) {
        console.error("Error saving whitelist:", error);
    }
}

// الـ Route الخاص بفحص الـ HWID من البرنامج
app.post('/api/auth', async (req, res) => { 
    const { hwid, username } = req.body; 
    
    if (!hwid) return res.status(400).json({ error: "HWID is required" });

    const whitelist = await getWhitelist(); 

    // الفحص الجديد: يتأكد أن الجهاز موجود وحالته مفعّلة approved
    if (whitelist[hwid] && whitelist[hwid].status === "approved") {
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
client.on('messageCreate', async (message) => { 
    if (message.author.bot || message.author.id !== '228898892425592832') return;
    if (message.channel.id !== process.env.DISCORD_CHANNEL_ID) return;

    if (message.content.startsWith('!add ')) {
        const hwid = message.content.split(' ')[1];
        if (!hwid) return;

        let whitelist = await getWhitelist(); 

        // جلب اسم المستخدم الذي أرسله كود الـ C++ والمخزن مؤقتاً في السيرفر
        const savedUsername = pendingRequests.get(hwid) || "Authorized User";

        if (pendingRequests.has(hwid) || !whitelist[hwid]) {
            // حفظ الاسم والحالة بداخل الـ HWID الخاص به في الفايربيز
            whitelist[hwid] = {
                username: savedUsername,
                status: "approved"
            };
            
            pendingRequests.delete(hwid);
            await saveWhitelist(whitelist); 
            message.reply(`✅ Access granted for **${savedUsername}** (HWID: \`${hwid}\`)`);
        } else if (whitelist[hwid]) {
            message.reply(`⚠️ HWID \`${hwid}\` is already approved.`);
        }
    }

    if (message.content.startsWith('!remove ')) {
        const hwid = message.content.split(' ')[1];
        if (!hwid) return;

        let whitelist = await getWhitelist(); 

        if (whitelist[hwid]) {
            delete whitelist[hwid]; // حذف الـ HWID ومحتوياته بذكاء من كائن الفايربيز
            await saveWhitelist(whitelist); 
            message.reply(`❌ Access revoked for HWID: \`${hwid}\``);
        } else {
            message.reply(`⚠️ HWID \`${hwid}\` not found in the whitelist.`);
        }
    }
});

client.on('ready', () => {
    console.log(`Bot is logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);
app.listen(process.env.PORT || 3000, () => console.log('Server is up and running!'));
