// ================= API AUTH =================
app.post('/api/auth', async (req, res) => { 
    const { hwid, username } = req.body; 
    
    if (!hwid || !username) {
        return res.status(400).json({ error: "HWID and Username are required" });
    }

    let whitelist = await getWhitelist(); 

    // 1. فحص الحظر اليدوي (إذا قمت أنت بضغظ زر الباند في ديسكورد)
    if (whitelist[hwid] && whitelist[hwid].status === "banned") {
        return res.status(403).json({ status: "banned", error: "This device is banned." });
    }

    // 2. منع استخدام اسم مسجل مسبقاً لجهاز آخر (يمنع التسجيل فقط بدون أي باند)
    const isUsernameTaken = Object.entries(whitelist).some(
        ([existingHwid, data]) => existingHwid !== hwid && data.username === username && data.status === "approved"
    );

    if (isUsernameTaken) {
        // نُرجع خطأ للمستخدم ليقوم بتغيير اسمه، السيرفر لن يعطيه باند هنا
        return res.status(400).json({ error: "هذا الاسم مستخدم لجهاز آخر، الرجاء اختيار اسم مختلف." });
    }

    // 3. فحص إذا كان الجهاز مقبولاً مسبقاً
    if (whitelist[hwid] && whitelist[hwid].status === "approved") {
        return res.json({ status: "approved" });
    }

    // 4. تسجيل الطلب الجديد في قاعدة البيانات وإرساله للديسكورد
    if (!whitelist[hwid] || whitelist[hwid].status === "denied") {
        whitelist[hwid] = {
            username: username,
            status: "pending"
        };

        await saveWhitelist(whitelist); 

        const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);

        if (channel) {
            const approveButton = new ButtonBuilder()
                .setCustomId(`approve_${hwid}`)
                .setLabel('Approve ✅')
                .setStyle(ButtonStyle.Success);

            const denyButton = new ButtonBuilder()
                .setCustomId(`deny_${hwid}`)
                .setLabel('Deny ❌')
                .setStyle(ButtonStyle.Danger);

            const banButton = new ButtonBuilder()
                .setCustomId(`ban_${hwid}`)
                .setLabel('Ban HWID 🔨')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(approveButton, denyButton, banButton);

            await channel.send({
                content: `📩 **New Auth Request!**\n👤 User: \`${username}\`\n🆔 HWID: \`${hwid}\``,
                components: [row]
            });
        }
    }

    return res.json({ status: "pending" });
});
