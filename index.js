const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const app = express();
app.use(express.json());

// إعطاء البوت صلاحية قراءة رسائلك
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// قائمة المسموح لهم
let whitelist = [];
if (fs.existsSync('whitelist.json')) {
    whitelist = JSON.parse(fs.readFileSync('whitelist.json'));
}

function saveWhitelist() {
    fs.writeFileSync('whitelist.json', JSON.stringify(whitelist));
}

// استقبال طلب C++
app.post('/api/auth', (req, res) => {
    const { hwid } = req.body;
    
    // إذا كان مسجلاً، يدخل فوراً
    if (whitelist.includes(hwid)) {
        return res.json({ status: "approved" });
    }

    // إذا لم يكن مسجلاً، يرسل لك إشعاراً
    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (channel) channel.send(`**New Request!**\nHWID: \`${hwid}\`\nللقبول اكتب: \`!add ${hwid}\``);
    
    return res.json({ status: "pending" });
});

// أوامر الديسكورد للتحكم
client.on('messageCreate', (message) => {
    if (message.author.bot) return;

    // أمر الإضافة الدائمة
    if (message.content.startsWith('!add ')) {
        const hwid = message.content.split(' ')[1];
        if (!whitelist.includes(hwid)) {
            whitelist.push(hwid);
            saveWhitelist();
            message.reply(`✅ تم السماح بالدخول للـ HWID: \`${hwid}\``);
        }
    }

    // أمر الحذف
    if (message.content.startsWith('!remove ')) {
        const hwid = message.content.split(' ')[1];
        whitelist = whitelist.filter(id => id !== hwid);
        saveWhitelist();
        message.reply(`❌ تم مسح الـ HWID: \`${hwid}\``);
    }
});

client.login(process.env.BOT_TOKEN);
app.listen(process.env.PORT || 3000);
