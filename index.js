const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios'); 

const app = express();
app.use(express.json());

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

// رابط الفايربيز الرئيسي الخاص بك
const DB_URL = "https://auth-aadf4-default-rtdb.firebaseio.com/whitelist.json";

// دالة جلب البيانات من الفايربيز
async function getWhitelist() {
    try {
        const response = await axios.get(DB_URL);
        return response.data || {}; 
    } catch (error) {
        console.error("Error fetching whitelist:", error);
        return {};
    }
}

// دالة حفظ البيانات في الفايربيز
async function saveWhitelist(whitelistObj) {
    try {
        await axios.put(DB_URL, whitelistObj);
    } catch (error) {
        console.error("Error saving whitelist:", error);
    }
}

// الـ Route الخاص بفحص الـ HWID والاسم المرفوع من برنامج الـ C++
app.post('/api/auth', async (req, res) => { 
    const { hwid, username } = req.body; 
    
    if (!hwid) return res.status(400).json({ error: "HWID is required" });

    let whitelist = await getWhitelist(); 

    // 1. إذا كان الجهاز موجود مسبقاً ومفعّل، يدخل فوراً
    if (whitelist[hwid] && whitelist[hwid].status === "approved") {
        return res.json({ status: "approved" });
    }

    // 2. إذا كان الجهاز غير موجود، نخزن الاسم فوراً في الفايربيز بحالة معلّقة (pending) لكي لا يضيع
    if (!whitelist[hwid]) {
        whitelist[hwid] = {
            username: username || "Unknown User",
            status: "pending"
        };
        await saveWhitelist(whitelist); // حفظ فوري في قاعدة البيانات مع الاسم

        // إرسال رسالة التفعيل للديسكورد
        const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
        if (channel) {
            channel.send(`**New Auth Request!**\nUser: \`${username || "Unknown User"}\`\nHWID: \`${hwid}\`\nTo approve, type: \`!add ${hwid}\``);
        }
    }
    
    return res.json({ status: "pending" });
});

// أوامر الديسكورد للتفعيل والحذف
client.on('messageCreate', async (message) => { 
    if (message.author.bot || message.author.id !== '228898892425592832') return;
    if (message.channel.id !== process.env.DISCORD_CHANNEL_ID) return;

    if (message.content.startsWith('!add ')) {
        const hwid = message.content.split(' ')[1];
        if (!hwid) return;

        let whitelist = await getWhitelist(); 

        // إذا كان الجهاز مسجلاً مسبقاً (سواء معلق أو مفعّل)
        if (whitelist[hwid]) {
            if (whitelist[hwid].status === "approved") {
                return message.reply(`⚠️ HWID \`${hwid}\` is already approved.`);
            }
            
            // تغيير الحالة فقط إلى approved مع الحفاظ على الاسم المخزن مسبقاً
            whitelist[hwid].status = "approved";
            await saveWhitelist(whitelist); 
            message.reply(`✅ Access granted for **${whitelist[hwid].username}** (HWID: \`${hwid}\`)`);
        } else {
            // في حال قمت بإضافة الـ HWID يدوياً من الديسكورد دون أن يفتح المستخدم البرنامج أولاً
            whitelist[hwid] = {
                username: "Added Directly via Discord",
                status: "approved"
            };
            await saveWhitelist(whitelist);
            message.reply(`✅ HWID \`${hwid}\` added and approved directly.`);
        }
    }

    if (message.content.startsWith('!remove ')) {
        const hwid = message.content.split(' ')[1];
        if (!hwid) return;

        let whitelist = await getWhitelist(); 

        if (whitelist[hwid]) {
            delete whitelist[hwid]; // حذف الجهاز بالكامل
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
app.listen(process.env.PORT || 3000, () => console.log('Server is running with Cloud-Pending logic!'));
