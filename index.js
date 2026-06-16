const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const app = express();
app.use(express.json());

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

let whitelist = [];
let pendingRequests = new Map(); 

if (fs.existsSync('whitelist.json')) {
    whitelist = JSON.parse(fs.readFileSync('whitelist.json'));
}

function saveWhitelist() {
    fs.writeFileSync('whitelist.json', JSON.stringify(whitelist));
}

app.post('/api/auth', (req, res) => {
    const { hwid, username } = req.body; 
    
    if (!hwid) return res.status(400).json({ error: "HWID is required" });

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

client.on('messageCreate', (message) => {
    if (message.author.bot || message.author.id !== '228898892425592832') return;
    if (message.channel.id !== process.env.DISCORD_CHANNEL_ID) return;

    if (message.content.startsWith('!add ')) {
        const hwid = message.content.split(' ')[1];
        if (hwid && pendingRequests.has(hwid)) {
            whitelist.push(hwid);
            pendingRequests.delete(hwid);
            saveWhitelist();
            message.reply(`✅ Access granted for HWID: \`${hwid}\``);
        } else if (whitelist.includes(hwid)) {
            message.reply(`⚠️ HWID \`${hwid}\` is already approved.`);
        } else {
            message.reply(`❌ No pending request found for HWID: \`${hwid}\`.`);
        }
    }

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

client.login(process.env.BOT_TOKEN);
app.listen(process.env.PORT || 3000);
