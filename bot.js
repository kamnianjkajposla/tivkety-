const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const express = require('express');
const session = require('express-session');

// ==========================================
// ⚙️ KONFIGURACJA OAUTH2 (DISCORD LOGIN)
// ==========================================
const CONFIG = {
    CLIENT_ID: process.env.DISCORD_CLIENT_ID || '1548644251884195880',
    CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || 'emTOywckSfXFKr8xCwWNiJW_6az1IAE0',
    REDIRECT_URI: process.env.DISCORD_REDIRECT_URI || 'https://tivkety.onrender.com/auth/discord/callback',
    PORT: process.env.PORT || 10000,
    SESSION_SECRET: 'tajnykluczsosession123'
};

// --- SERWER HTTP I PANEL WWW ---
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: CONFIG.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

let clientInstance = null;
const verifiedRoles = new Map();
const loginHistory = [];

// STRONA LOGOWANIA (PRZEZ DISCORDA)
app.get('/', (req, res) => {
    if (req.session.loggedIn) {
        return res.redirect('/dashboard');
    }

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
                    <p>Zarządzaj swoim botem i systemem weryfikacji po zalogowaniu kontem Discord.</p>
                    <a href="${discordAuthUrl}" class="btn-discord">Zaloguj przez Discord</a>
                </div>
            </body>
        </html>
    `);
});

// CALLBACK OAUTH2 Z DISCORDA
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

// Wylogowanie
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// PANEL STEROWANIA (TYLKO SERWERY, NA KTÓRYCH UŻYTKOWNIK JEST ADMINEM)
app.get('/dashboard', (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');

    if (!clientInstance || !clientInstance.isReady()) {
        return res.send('<h1>Bot się uruchamia... Odśwież stronę za chwilę.</h1>');
    }

    const user = req.session.user;
    const userGuilds = req.session.userGuilds || [];

    // Filtrujemy serwery: użytkownik musi być właścicielem lub mieć uprawnienie Administrator oraz bot musi być na tym serwerze
    const manageableGuilds = userGuilds.filter(g => {
        const hasAdmin = (BigInt(g.permissions) & BigInt(0x8)) === BigInt(0x8) || g.owner;
        const botIsInGuild = clientInstance.guilds.cache.has(g.id);
        return hasAdmin && botIsInGuild;
    });

    const guildsOptions = manageableGuilds.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    
    const totalServers = clientInstance.guilds.cache.size;
    const totalUsers = clientInstance.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
    const historyHtml = loginHistory.map(item => `<li style="margin-bottom: 5px;"><b>${item.name}</b> <span style="color: #949ba4; font-size: 11px;">(${item.time})</span></li>`).join('');

    res.send(`
        <html>
            <head>
                <title>Panel Bota Tivkety</title>
                <style>
                    body { font-family: Arial, sans-serif; background-color: #313338; color: #fff; text-align: center; padding: 30px; }
                    .container { display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; }
                    .card { background-color: #2b2d31; padding: 25px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); width: 400px; text-align: left; }
                    h1 { color: #5865F2; text-align: center; font-size: 22px; }
                    h3 { font-size: 16px; margin-top: 0; color: #b5bac1; border-bottom: 1px solid #4e5058; padding-bottom: 8px; }
                    label { display: block; margin-top: 12px; color: #dbdee1; font-size: 14px; }
                    select, input { width: 100%; padding: 8px; margin-top: 4px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; box-sizing: border-box; }
                    button { width: 100%; background: #5865F2; color: #fff; padding: 10px; border: none; border-radius: 4px; cursor: pointer; margin-top: 15px; font-weight: bold; }
                    button:hover { background: #4752c4; }
                    .logout { display: block; text-align: center; margin-top: 20px; color: #f23f43; text-decoration: none; font-weight: bold; }
                    .stat-box { background: #1e1f22; padding: 10px; border-radius: 5px; margin-bottom: 10px; font-size: 14px; }
                    ul { padding-left: 20px; max-height: 150px; overflow-y: auto; font-size: 13px; background: #1e1f22; padding: 10px; border-radius: 5px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <!-- Kafel 1: Konfiguracja weryfikacji -->
                    <div class="card">
                        <h1>Panel Tivkety</h1>
                        <p style="font-size: 13px; color: #949ba4; text-align: center;">Zalogowany: <b>${user.username}</b></p>
                        
                        <h3>Konfiguracja weryfikacji</h3>
                        ${guildsOptions ? `
                        <form method="POST" action="/configure">
                            <label>Wybierz swój serwer:</label>
                            <select name="guildId">${guildsOptions}</select>
                            
                            <label>ID kanału weryfikacji:</label>
                            <input type="text" name="channelId" required>
                            
                            <label>ID roli po weryfikacji:</label>
                            <input type="text" name="roleId" required>
                            
                            <button type="submit">Wyślij panel weryfikacji</button>
                        </form>
                        ` : '<p style="color: #f23f43; font-size: 13px; text-align: center;">Nie masz uprawnień administratora na żadnym serwerze, na którym jest ten bot!</p>'}

                        <a href="/logout" class="logout">Wyloguj się</a>
                    </div>

                    <!-- Kafel 2: Statystyki i Historia Logowań -->
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

// Zapis konfiguracji
app.post('/configure', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');
    const { guildId, channelId, roleId } = req.body;

    const guild = clientInstance.guilds.cache.get(guildId);
    if (!guild) return res.send('Nie znaleziono serwera. <a href="/dashboard">Wróć</a>');

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.send('Nie znaleziono kanału o podanym ID. <a href="/dashboard">Wróć</a>');

    try {
        verifiedRoles.set(guildId, roleId);

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

        res.send('<h2>Panel weryfikacyjny został pomyślnie wysłany na kanał!</h2><a href="/dashboard">Wróć do panelu</a>');
    } catch (err) {
        console.error(err);
        res.send('Wystąpił błąd. Upewnij się, że bot ma uprawnienia administratora. <a href="/dashboard">Wróć</a>');
    }
});

// Statystyki dla UptimeRobot
app.get('/stats', (req, res) => {
    if (!clientInstance || !clientInstance.isReady()) return res.send('Bot się uruchamia...');
    res.send(`Serwery: ${clientInstance.guilds.cache.size}, Użytkownicy: ${clientInstance.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)}`);
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

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}!`);
});

client.on('guildMemberAdd', async member => {
    try {
        let unverifiedRole = member.guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');
        if (!unverifiedRole) {
            unverifiedRole = await member.guild.roles.create({ name: 'Niezweryfikowany', color: '#808080', permissions: [] });
        }
        await member.roles.add(unverifiedRole);
    } catch (error) {
        console.error('Błąd podczas nadawania roli Niezweryfikowany:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'verify_button') {
        const guildId = interaction.guild.id;
        let verifiedRoleId = verifiedRoles.get(guildId);
        
        if (!verifiedRoleId) {
            const fallbackRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'zweryfikowany');
            if (fallbackRole) {
                verifiedRoleId = fallbackRole.id;
                verifiedRoles.set(guildId, verifiedRoleId);
            } else {
                return interaction.reply({ content: 'Weryfikacja nie została skonfigurowana lub rola nie została przypisana. Skonfiguruj ją ponownie w panelu.', ephemeral: true });
            }
        }

        const verifiedRole = interaction.guild.roles.cache.get(verifiedRoleId);
        const unverifiedRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');

        if (!verifiedRole) {
            return interaction.reply({ content: 'Nie znaleziono docelowej roli weryfikacji na serwerze.', ephemeral: true });
        }

        try {
            await interaction.member.roles.add(verifiedRole);
            if (unverifiedRole && interaction.member.roles.cache.has(unverifiedRole.id)) {
                await interaction.member.roles.remove(unverifiedRole);
            }
            await interaction.reply({ content: 'Pomyślnie zweryfikowano!', ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Wystąpił błąd. Sprawdź pozycję roli bota.', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
