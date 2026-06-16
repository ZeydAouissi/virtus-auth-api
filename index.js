const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const app = express();
app.use(express.json());

// إعداد بوت الديسكورد مع الصلاحيات المطلوبة
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// قائمة الأجهزة المصرح لها
let whitelist = [];
if (fs.existsSync('whitelist.json')) {
    whitelist = JSON.parse(fs.readFileSync('whitelist.json'));
}

// دالة لحفظ القائمة
function saveWhitelist() {
    fs.writeFileSync('whitelist.json', JSON.stringify(whitelist));
}

// مسار استقبال الطلبات من C++
app.post('/api/auth', (req, res) => {
    const { hwid } = req.body;
    
    if (!hwid) {
        return res.status(400).json({ error: "HWID is required" });
    }

    // إذا كان الجهاز مصرحاً له، يوافق فوراً بدون إرسال رسالة للديسكورد
    if (whitelist.includes(hwid)) {
        return res.json({ status: "approved" });
    }

    // إذا لم يكن مصرحاً له، يرسل إشعاراً واحداً فقط للديسكورد
    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (channel) {
        channel.send(`**New Auth Request!**\nHWID: \`${hwid}\`\nTo approve, type: \`!add ${hwid}\``);
    }
    
    return res.json({ status: "pending" });
});

// استقبال الأوامر في الديسكورد
client.on('messageCreate', (message) => {
    // تجاهل رسائل البوتات
    if (message.author.bot) return;

    // الأمان: فقط الأيدي الخاص بك يمكنه استخدام الأوامر
    if (message.author.id !== '228898892425592832') return;

    // أمر الإضافة
    if (message.content.startsWith('!add ')) {
        const hwid = message.content.split(' ')[1];
        if (hwid && !whitelist.includes(hwid)) {
            whitelist.push(hwid);
            saveWhitelist();
            message.reply(`✅ Access granted for HWID: \`${hwid}\``);
        } else if (whitelist.includes(hwid)) {
            message.reply(`⚠️ HWID \`${hwid}\` is already approved.`);
        }
    }

    // أمر الحذف
    if (message.content.startsWith('!remove ')) {
        const hwid = message.content.split(' ')[1];
        if (hwid && whitelist.includes(hwid)) {
            whitelist = whitelist.filter(id => id !== hwid);
            saveWhitelist();
            message.reply(`❌ Access revoked for HWID: \`${hwid}\``);
        } else {
            message.reply(`⚠️ HWID \`${hwid}\` not found in the whitelist.`);
        }
    }
});

// تشغيل البوت والخادم
client.once('ready', () => {
    console.log(`[INFO] Discord Bot is ready! Logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[INFO] VIRTUS API Server is running on port ${PORT}`);
});
