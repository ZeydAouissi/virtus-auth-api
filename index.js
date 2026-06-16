const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());

// إعداد بوت الديسكورد
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// مسار الـ API الذي سيستقبل الطلب من برنامج VIRTUS C++
app.post('/api/auth', async (req, res) => {
    const { hwid } = req.body;
    
    if (!hwid) {
        return res.status(400).json({ error: "HWID is required" });
    }

    // إرسال رسالة إلى قناة مخصصة في سيرفر الديسكورد
    // يجب وضع أيدي القناة في إعدادات Render لاحقاً
    const channelId = process.env.DISCORD_CHANNEL_ID;
    const channel = client.channels.cache.get(channelId);

    if (channel) {
        channel.send(`**New VIRTUS Auth Request!**\nHWID: \`${hwid}\`\nWaiting for admin approval...`);
        return res.status(200).json({ message: "Request sent to Discord server." });
    } else {
        console.log("[ERROR] Discord channel not found!");
        return res.status(500).json({ error: "Internal server error" });
    }
});

// تشغيل البوت
client.once('ready', () => {
    console.log(`[INFO] Discord Bot is ready! Logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);

// تشغيل خادم الـ API
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[INFO] VIRTUS API Server is running on port ${PORT}`);
});
