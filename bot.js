const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, PermissionsBitField, ChannelType } = require('discord.js');
const express = require('express');
const session = require('express-session');
const admin = require('firebase-admin');

// ==========================================
// ⚙️ KONFIGURACJA FIREBASE (ADMIN / BACKEND)
// ==========================================
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } else {
        const serviceAccount = require('./serviceAccountKey.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    console.log("Połączono z Firebase Admin pomyślnie!");
} catch (e) {
    console.log("Błąd inicjalizacji Firebase Admin: Upewnij się, że poświadczenia są skonfigurowane w Render lub jako plik lokalny.");
}

const db = admin.apps.length ? admin.firestore() : null;

async function getServerConfig(guildId) {
    if (!db) return {};
    try {
        const docRef = db.collection('server_configs').doc(guildId);
        const doc = await docRef.get();
        if (doc.exists) return doc.data();
    } catch (err) {
        console.error('Błąd pobierania konfiguracji z Firebase:', err);
    }
    return {};
}

async function saveServerConfig(guildId, data) {
    if (!db) return;
    try {
        await db.collection('server_configs').doc(guildId).set(data, { merge: true });
    } catch (err) {
        console.error('Błąd zapisu konfiguracji do Firebase:', err);
    }
}

// ==========================================
// ⚙️ KONFIGURACJA OAUTH2 I FIREBASE WEB
// ==========================================
const CONFIG = {
    CLIENT_ID: process.env.DISCORD_CLIENT_ID || '1548644251884195880',
    CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || 'emTOywckSfXFKr8xCwWNiJW_6az1IAE0',
    REDIRECT_URI: process.env.DISCORD_REDIRECT_URI || 'https://tivkety.onrender.com/auth/discord/callback',
    PORT: process.env.PORT || 10000,
    SESSION_SECRET: process.env.SESSION_SECRET || 'tajnykluczsosession123',
    // Konfiguracja Firebase Web (z konsoli Firebase)
    FIREBASE_WEB_CONFIG: JSON.stringify({
        apiKey: "AIzaSyBlhq_Qw_D_irwqm4VPqT6rKRapl3bdeLc",
        authDomain: "botdc-43757.firebaseapp.com",
        projectId: "botdc-43757",
        storageBucket: "botdc-43757.firebasestorage.app",
        messagingSenderId: "848908548545",
        appId: "1:848908548545:web:bec47867e9073b0f051740"
    })
};

const loginHistory = [];
let clientInstance = null;

// --- SERWER HTTP I PANEL WWW ---
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: CONFIG.SESSION_SECRET,
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.get('/', (req, res) => {
    if (req.session.loggedIn) return res.redirect('/dashboard');

    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;

    res.send(`
        <html>
            <head>
                <title>Logowanie - Tivkety</title>
                <style>
                    body { font-family: Arial, sans-serif; background-color: #313338; color: #fff; text-align: center; padding-top: 100px; }
                    .card { background-color: #2b2d31; display: inline-block; padding: 40px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); width: 350px; }
                    h1 { color: #5865F2; font-size: 24px; margin-bottom: 20px; }
                    p { color: #949ba4; font-size: 14px; margin-bottom: 30px; }
                    .btn-discord { background: #5865F2; color: #fff; padding: 14px 20px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; text-decoration: none; display: inline-block; width: 100%; box-sizing: border-box; }
                    .btn-discord:hover { background: #4752c4; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>Panel Tivkety</h1>
                    <p>Zarządzaj swoim botem, weryfikacją i ticketami przez Firebase.</p>
                    <a href="${discordAuthUrl}" class="btn-discord">Zaloguj przez Discord</a>
                </div>
            </body>
        </html>
    `);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/');

    try {
        const tokenParam = new URLSearchParams({
            client_id: CONFIG.CLIENT_ID,
            client_secret: CONFIG.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: CONFIG.REDIRECT_URI,
        });

        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: tokenParam,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const tokenData = await tokenRes.json();

        if (!tokenData.access_token) return res.redirect('/');

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { authorization: `Bearer ${tokenData.access_token}` }
        });
        const guildsData = await guildsRes.json();

        req.session.loggedIn = true;
        req.session.user = userData;
        req.session.userGuilds = guildsData;

        loginHistory.unshift({
            name: `${userData.username} (#${userData.id})`,
            time: new Date().toLocaleString('pl-PL')
        });

        res.redirect('/dashboard');
    } catch (err) {
        console.error('Błąd autoryzacji Discord:', err);
        res.redirect('/');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');

    if (!clientInstance || !clientInstance.isReady()) {
        return res.send('<h1>Bot się uruchamia... Odśwież stronę za chwilę.</h1>');
    }

    const user = req.session.user;
    const userGuilds = req.session.userGuilds || [];

    const adminGuilds = userGuilds.filter(g => {
        return (BigInt(g.permissions) & BigInt(0x8)) === BigInt(0x8) || g.owner;
    });

    let serversHtml = '';

    if (adminGuilds.length === 0) {
        serversHtml = '<p style="color: #f23f43; font-size: 13px; text-align: center;">Nie masz uprawnień administratora na żadnym serwerze!</p>';
    } else {
        for (const g of adminGuilds) {
            const botIsInGuild = clientInstance.guilds.cache.has(g.id);
            const savedConfig = await getServerConfig(g.id);
            
            serversHtml += `<div style="background: #1e1f22; padding: 15px; border-radius: 6px; margin-bottom: 15px;">`;
            serversHtml += `<h4 style="margin: 0 0 10px 0; color: #fff; font-size: 15px;">🌐 ${g.name}</h4>`;

            if (botIsInGuild) {
                const guildObj = clientInstance.guilds.cache.get(g.id);
                const channels = guildObj.channels.cache.filter(c => c.type === ChannelType.GuildText);
                const roles = guildObj.roles.cache.filter(r => !r.managed && r.name !== '@everyone');

                let channelOptions = '<option value="">-- Wybierz kanał --</option>';
                channels.forEach(c => {
                    channelOptions += `<option value="${c.id}">#${c.name}</option>`;
                });

                let roleOptions = '<option value="">-- Wybierz rolę --</option>';
                roles.forEach(r => {
                    roleOptions += `<option value="${r.id}">@${r.name}</option>`;
                });

                const makeSelect = (name, options, selectedVal) => {
                    return `<select name="${name}" required style="width: 100%; padding: 6px; margin-top: 2px; margin-bottom: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 12px;">` +
                        options.replace(`value="${selectedVal}"`, `value="${selectedVal}" selected`) +
                        `</select>`;
                };

                serversHtml += `
                    <p style="color: #23a55a; font-size: 12px; margin: 0 0 10px 0;">✔ Bot jest na tym serwerze</p>
                    
                    <!-- Formularz Weryfikacji -->
                    <form method="POST" action="/configure-verify" style="margin-bottom: 15px; border-bottom: 1px solid #383a40; padding-bottom: 10px;">
                        <input type="hidden" name="guildId" value="${g.id}">
                        <strong style="color: #5865F2; font-size: 13px;">Weryfikacja:</strong>
                        <label style="font-size: 11px; color: #dbdee1;">Kanał weryfikacji:</label>
                        ${makeSelect('channelId', channelOptions, savedConfig.verifyChannel)}
                        
                        <label style="font-size: 11px; color: #dbdee1;">Rola po weryfikacji:</label>
                        ${makeSelect('roleId', roleOptions, savedConfig.verifyRole)}
                        
                        <button type="submit" style="padding: 6px; font-size: 12px;">Wyślij panel weryfikacji</button>
                    </form>

                    <!-- Formularz Ticketów -->
                    <form method="POST" action="/configure-ticket">
                        <input type="hidden" name="guildId" value="${g.id}">
                        <strong style="color: #5865F2; font-size: 13px;">Tickety (Zgłoszenia):</strong>
                        <label style="font-size: 11px; color: #dbdee1;">Kanał ticketów:</label>
                        ${makeSelect('ticketChannelId', channelOptions, savedConfig.ticketChannel)}
                        
                        <label style="font-size: 11px; color: #dbdee1;">Treść wiadomości panelu:</label>
                        <input type="text" name="ticketMessage" value="${savedConfig.ticketMessage || 'Kliknij poniższy przycisk, aby otworzyć ticket.'}" required style="width: 100%; padding: 6px; margin-top: 2px; margin-bottom: 8px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; box-sizing: border-box; font-size: 12px;">
                        
                        <button type="submit" style="padding: 6px; font-size: 12px; background: #23a55a;">Wyślij panel ticketów</button>
                    </form>
                `;
            } else {
                const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&permissions=8&scope=bot&guild_id=${g.id}&disable_guild_select=true`;
                serversHtml += `
                    <p style="color: #f0b232; font-size: 12px; margin: 0 0 10px 0;">⚠ Bota nie ma na tym serwerze</p>
                    <a href="${inviteUrl}" target="_blank" style="background: #23a55a; color: #fff; padding: 8px 12px; border-radius: 4px; text-decoration: none; display: block; text-align: center; font-size: 13px; font-weight: bold;">➕ Dodaj bota na serwer</a>
                `;
            }

            serversHtml += `</div>`;
        }
    }

    const totalServers = clientInstance.guilds.cache.size;
    const totalUsers = clientInstance.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
    const historyHtml = loginHistory.map(item => `<li style="margin-bottom: 5px;"><b>${item.name}</b> <span style="color: #949ba4; font-size: 11px;">(${item.time})</span></li>`).join('');

    res.send(`
        <html>
            <head>
                <title>Panel Bota Tivkety</title>
                <style>
                    body { font-family: Arial, sans-serif; background-color: #313338; color: #fff; text-align: center; padding: 30px; }
                    .container { display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
                    .card { background-color: #2b2d31; padding: 25px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); width: 480px; text-align: left; }
                    h1 { color: #5865F2; text-align: center; font-size: 22px; }
                    h3 { font-size: 15px; margin-top: 0; color: #b5bac1; border-bottom: 1px solid #4e5058; padding-bottom: 8px; }
                    label { display: block; margin-top: 4px; color: #dbdee1; font-size: 12px; }
                    button { width: 100%; background: #5865F2; color: #fff; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
                    button:hover { background: #4752c4; }
                    .logout { display: block; text-align: center; margin-top: 20px; color: #f23f43; text-decoration: none; font-weight: bold; }
                    .stat-box { background: #1e1f22; padding: 10px; border-radius: 5px; margin-bottom: 10px; font-size: 14px; }
                    ul { padding-left: 20px; max-height: 150px; overflow-y: auto; font-size: 13px; background: #1e1f22; padding: 10px; border-radius: 5px; }
                    .servers-list { max-height: 550px; overflow-y: auto; padding-right: 5px; }
                </style>
                <!-- Firebase Web SDK Integration -->
                <script type="module">
                    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
                    const firebaseConfig = ${CONFIG.FIREBASE_WEB_CONFIG};
                    const app = initializeApp(firebaseConfig);
                    console.log("Firebase Web zainicjalizowany pomyślnie w przeglądarce.");
                </script>
            </head>
            <body>
                <div class="container">
                    <div class="card">
                        <h1>Panel Tivkety</h1>
                        <p style="font-size: 13px; color: #949ba4; text-align: center; margin-bottom: 20px;">Zalogowany: <b>${user.username}</b></p>
                        
                        <h3>Twoje serwery i zarządzanie</h3>
                        <div class="servers-list">
                            ${serversHtml}
                        </div>

                        <a href="/logout" class="logout">Wyloguj się</a>
                    </div>

                    <div class="card">
                        <h1>Statystyki i Logowania</h1>
                        <h3>Statystyki Bota</h3>
                        <div class="stat-box">Serwery: <b>${totalServers}</b></div>
                        <div class="stat-box">Łącznie użytkowników: <b>${totalUsers}</b></div>

                        <h3 style="margin-top: 20px;">Ostatnio logujący się</h3>
                        <ul>
                            ${historyHtml || '<li>Brak logowań w tej sesji.</li>'}
                        </ul>
                    </div>
                </div>
            </body>
        </html>
    `);
});

app.post('/configure-verify', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');
    const { guildId, channelId, roleId } = req.body;

    const guild = clientInstance.guilds.cache.get(guildId);
    if (!guild) return res.send('Nie znaleziono bota na tym serwerze. <a href="/dashboard">Wróć</a>');

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.send('Nie znaleziono wybranego kanału. <a href="/dashboard">Wróć</a>');

    try {
        await saveServerConfig(guildId, { verifyChannel: channelId, verifyRole: roleId });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_button')
                .setLabel('Zweryfikuj się')
                .setStyle(ButtonStyle.Success)
        );

        await channel.send({
            content: '**Weryfikacja serwera**\nKliknij poniższy przycisk, aby odblokować dostęp do całego serwera:',
            components: [row]
        });

        res.send('<h2>Panel weryfikacyjny został wysłany i zapisany w Firebase!</h2><a href="/dashboard">Wróć do panelu</a>');
    } catch (err) {
        console.error(err);
        res.send('Wystąpił błąd. <a href="/dashboard">Wróć</a>');
    }
});

app.post('/configure-ticket', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');
    const { guildId, ticketChannelId, ticketMessage } = req.body;

    const guild = clientInstance.guilds.cache.get(guildId);
    if (!guild) return res.send('Nie znaleziono bota na tym serwerze. <a href="/dashboard">Wróć</a>');

    const channel = guild.channels.cache.get(ticketChannelId);
    if (!channel) return res.send('Nie znaleziono wybranego kanału ticketów. <a href="/dashboard">Wróć</a>');

    try {
        await saveServerConfig(guildId, { ticketChannel: ticketChannelId, ticketMessage });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('Stwórz ticket 🎫')
                .setStyle(ButtonStyle.Primary)
        );

        await channel.send({
            content: `**System Zgłoszeń (Tickety)**\n${ticketMessage}`,
            components: [row]
        });

        res.send('<h2>Panel ticketów został wysłany i zapisany w Firebase!</h2><a href="/dashboard">Wróć do panelu</a>');
    } catch (err) {
        console.error(err);
        res.send('Wystąpił błąd. <a href="/dashboard">Wróć</a>');
    }
});

app.listen(CONFIG.PORT, () => console.log(`Serwer HTTP uruchomiony na porcie ${CONFIG.PORT}`));

// --- BOT DISCORDA ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

clientInstance = client;

const commands = [
    new SlashCommandBuilder()
        .setName('weryfikacja')
        .setDescription('Wysyła panel weryfikacyjny')
        .addChannelOption(option => option.setName('kanal').setDescription('Kanał').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addRoleOption(option => option.setName('rola').setDescription('Rola').setRequired(true)),
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Wysyła panel ticketów')
        .addChannelOption(option => option.setName('kanal').setDescription('Kanał').addChannelTypes(ChannelType.GuildText).setRequired(true))
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Zalogowano jako ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands });
        console.log('Zarejestrowano komendy slash.');
    } catch (error) {
        console.error('Błąd rejestracji komend:', error);
    }
});

client.on('guildMemberAdd', async member => {
    try {
        let unverifiedRole = member.guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');
        if (!unverifiedRole) {
            unverifiedRole = await member.guild.roles.create({ name: 'Niezweryfikowany', color: '#808080', permissions: [] });
        }
        await member.roles.add(unverifiedRole);
    } catch (error) {
        console.error('Błąd roli niezweryfikowany:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'weryfikacja') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'Brak uprawnień!', ephemeral: true });
            }
            const channel = interaction.options.getChannel('kanal');
            const role = interaction.options.getRole('rola');
            
            await saveServerConfig(interaction.guild.id, { verifyChannel: channel.id, verifyRole: role.id });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verify_button').setLabel('Zweryfikuj się').setStyle(ButtonStyle.Success)
            );
            await channel.send({ content: '**Weryfikacja serwera**', components: [row] });
            await interaction.reply({ content: 'Wysłano panel weryfikacji!', ephemeral: true });
        }

        if (interaction.commandName === 'ticket') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'Brak uprawnień!', ephemeral: true });
            }
            const channel = interaction.options.getChannel('kanal');
            
            await saveServerConfig(interaction.guild.id, { ticketChannel: channel.id });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('create_ticket').setLabel('Stwórz ticket 🎫').setStyle(ButtonStyle.Primary)
            );
            await channel.send({ content: '**System Zgłoszeń (Tickety)**', components: [row] });
            await interaction.reply({ content: 'Wysłano panel ticketów!', ephemeral: true });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'verify_button') {
            const config = await getServerConfig(interaction.guild.id);
            const verifiedRoleId = config.verifyRole || interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'zweryfikowany')?.id;
            
            if (!verifiedRoleId) return interaction.reply({ content: 'Brak skonfigurowanej roli.', ephemeral: true });

            const verifiedRole = interaction.guild.roles.cache.get(verifiedRoleId);
            const unverifiedRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');

            try {
                await interaction.member.roles.add(verifiedRole);
                if (unverifiedRole) await interaction.member.roles.remove(unverifiedRole);
                await interaction.reply({ content: 'Pomyślnie zweryfikowano!', ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: 'Błąd nadawania ról.', ephemeral: true });
            }
        }

        if (interaction.customId === 'create_ticket') {
            const guild = interaction.guild;
            const user = interaction.user;

            try {
                await interaction.deferReply({ ephemeral: true });
                const ticketChannel = await guild.channels.create({
                    name: `ticket-${user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
                    ],
                });

                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Zamknij ticket 🔒').setStyle(ButtonStyle.Danger)
                );

                await ticketChannel.send({
                    content: `Witaj ${user}! Administracja wkrótce Ci pomoże.`,
                    components: [closeRow]
                });

                await interaction.editReply({ content: `Utworzono ticket: ${ticketChannel}!` });
            } catch (err) {
                await interaction.editReply({ content: 'Błąd tworzenia kanału ticketu.' });
            }
        }

        if (interaction.customId === 'close_ticket') {
            await interaction.reply({ content: 'Zamykanie ticketu za 3 sekundy...' });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
