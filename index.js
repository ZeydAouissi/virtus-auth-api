const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios'); 

const app = express();
app.use(express.json());

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

const DB_URL = "https://auth-aadf4-default-rtdb.firebaseio.com/whitelist.json";

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

// الـ Route المطور لمعاينة البيانات القادمة من الـ C++
app.post('/api/auth', async (req, res) => { 
    
    // 👇 السطرين القادمين سيطبعان لك في شاشة Render السوداء البيانات القادمة فوراً
    console.log("====== طلب جديد وصل للسيرفر ======");
    console.log("البيانات المرسلة من البرنامج هي:", req.body); 

    const { hwid, username } = req.body; 
    
    if (!hwid) {
        console.log("❌ فشل الطلب: البرنامج لم يرسل الـ hwid أو تم إرساله بحروف كابيتال مجدداً");
        return res.status(400).json({ error: "HWID is required" });
    }

    let whitelist = await getWhitelist(); 

    if (whitelist[hwid] && whitelist[hwid].status === "approved") {
        return res.json({ status: "approved" });
    }

    if (!whitelist[hwid]) {
        whitelist[hwid] = {
            username: username || "Unknown User",
            status: "pending"
        };
        await saveWhitelist(whitelist); 
        console.log(`✅ تم حفظ الجهاز بنجاح في الفايربيز: ${hwid}`);

        const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
        if (channel) {
            channel.send(`**New Auth Request!**\nUser: \`${username || "Unknown User"}\`\nHWID: \`${hwid}\`\nTo approve, type: \`!add ${hwid}\``);
        }
    }
    
    return res.json({ status: "pending" });
});

client.on('messageCreate', async (message) => { 
    if (message.author.bot || message.author.id !== '228898892425592832') return;
    if (message.channel.id !== process.env.DISCORD_CHANNEL_ID) return;

    if (message.content.startsWith('!add ')) {
        const hwid = message.content.split(' ')[1];
        if (!hwid) return;

        let whitelist = await getWhitelist(); 

        if (whitelist[hwid]) {
            if (whitelist[hwid].status === "approved") {
                return message.reply(`⚠️ HWID \`${hwid}\` is already approved.`);
            }
            
            whitelist[hwid].status = "approved";
            await saveWhitelist(whitelist); 
            message.reply(`✅ Access granted for **${whitelist[hwid].username}** (HWID: \`${hwid}\`)`);
        } else {
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
            delete whitelist[hwid]; 
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
