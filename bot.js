const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, PermissionsBitField, ChannelType, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const express = require('express');
const session = require('express-session');
const admin = require('firebase-admin');

// ==========================================
// ⚙️ KONFIGURACJA FIREBASE
// ==========================================
let db = null;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const rawCreds = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
        const serviceAccount = JSON.parse(rawCreds);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ Połączono z Firebase Admin używając zmiennej środowiskowej!");
    } else {
        const serviceAccount = require('./serviceAccountKey.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ Połączono z Firebase Admin używając pliku lokalnego!");
    }
    db = admin.firestore();
} catch (e) {
    console.error("❌ KRYTYCZNY BŁĄD INICJALIZACJI FIREBASE:", e.message);
}

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
        console.log(`✅ Zapisano pomyślnie config dla serwera: ${guildId}`);
    } catch (err) {
        console.error('❌ Błąd zapisu konfiguracji do Firebase:', err);
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

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json());
app.use(session({
    secret: CONFIG.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: { 
        secure: true,
        maxAge: 7 * 24 * 60 * 60 * 1000 
    }
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
                    <p>Zarządzaj weryfikacją, wieloma kategoriami i rolami obsługi.</p>
                    <a href="${discordAuthUrl}" class="btn-discord">Zaloguj przez Discord</a>
                </div>
            </body>
        </html>
    `);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/?error=no_code');

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
        if (!tokenData.access_token) {
            console.error('Błąd tokenu Discord:', tokenData);
            return res.redirect('/?error=invalid_token');
        }

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
        req.session.userGuilds = Array.isArray(guildsData) ? guildsData : [];

        loginHistory.unshift({
            name: `${userData.username} (#${userData.id})`,
            time: new Date().toLocaleString('pl-PL')
        });

        res.redirect('/dashboard');
    } catch (err) {
        console.error('Błąd autoryzacji Discord:', err);
        res.redirect('/?error=server_error');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');

    if (!clientInstance || !clientInstance.isReady()) {
        return res.send('<h1>Bot się uruchamia... Odśwież stronę za chwilę.</h1><script>setTimeout(() => window.location.reload(), 3000);</script>');
    }

    const user = req.session.user;
    const userGuilds = req.session.userGuilds || [];
    const adminGuilds = userGuilds.filter(g => (BigInt(g.permissions) & BigInt(0x8)) === BigInt(0x8) || g.owner);

    let serversHtml = '';

    if (adminGuilds.length === 0) {
        serversHtml = '<p style="color: #f23f43; font-size: 13px; text-align: center;">Nie masz uprawnień administratora na żadnym serwerze!</p>';
    } else {
        for (const g of adminGuilds) {
            const botIsInGuild = clientInstance.guilds.cache.has(g.id);
            const savedConfig = await getServerConfig(g.id);
            
            serversHtml += `<div style="background: #1e1f22; padding: 15px; border-radius: 6px; margin-bottom: 20px; border: 1px solid #383a40;">`;
            serversHtml += `<h4 style="margin: 0 0 10px 0; color: #fff; font-size: 16px;">🌐 ${g.name}</h4>`;

            if (botIsInGuild) {
                const guildObj = clientInstance.guilds.cache.get(g.id);
                const channels = guildObj.channels.cache.filter(c => c.type === ChannelType.GuildText);
                const roles = guildObj.roles.cache.filter(r => !r.managed && r.name !== '@everyone');

                let channelOptions = '<option value="">-- Wybierz kanał --</option>';
                channels.forEach(c => { channelOptions += `<option value="${c.id}">#${c.name}</option>`; });

                let roleCheckboxes = '';
                const savedSupportRoles = savedConfig.supportRoles || [];
                roles.forEach(r => {
                    const isChecked = savedSupportRoles.includes(r.id) ? 'checked' : '';
                    roleCheckboxes += `<label style="display:inline-block; margin-right: 10px; font-size:11px; color:#dbdee1;"><input type="checkbox" name="supportRoles" value="${r.id}" ${isChecked}> @${r.name}</label>`;
                });

                const makeSelect = (name, options, selectedVal) => {
                    return `<select name="${name}" required style="width: 100%; padding: 6px; margin-top: 2px; margin-bottom: 8px; background: #2b2d31; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 12px;">` +
                        options.replace(`value="${selectedVal}"`, `value="${selectedVal}" selected`) +
                        `</select>`;
                };

                const categories = savedConfig.ticketCategories || [
                    { name: 'Pomoc Techniczna', question: 'Opisz swój problem dokładnie:' }
                ];

                let categoriesHtml = '';
                categories.forEach((cat, index) => {
                    categoriesHtml += `
                        <div class="category-item" style="background: #2b2d31; padding: 10px; border-radius: 4px; margin-bottom: 10px; border: 1px solid #383a40;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                <span style="font-size: 11px; color: #5865F2; font-weight: bold;">Kategoria #${index + 1}</span>
                                <button type="button" onclick="this.closest('.category-item').remove()" style="background: #f23f43; color: white; border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 10px;">Usuń kategorię</button>
                            </div>
                            <label style="font-size: 10px; color: #949ba4;">Nazwa Kategorii:</label>
                            <input type="text" name="catName[]" value="${cat.name}" required style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 3px; font-size: 11px; margin-bottom: 5px;">
                            <label style="font-size: 10px; color: #949ba4;">Pytanie w formularzu (Modal):</label>
                            <textarea name="catQuestion[]" required style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 3px; font-size: 11px; resize: vertical; height: 45px;">${cat.question}</textarea>
                        </div>
                    `;
                });

                serversHtml += `
                    <p style="color: #23a55a; font-size: 12px; margin: 0 0 10px 0;">✔ Bot jest na serwerze</p>
                    
                    <!-- WERYFIKACJA -->
                    <form method="POST" action="/configure-verify" style="margin-bottom: 15px; border-bottom: 1px solid #383a40; padding-bottom: 12px;">
                        <input type="hidden" name="guildId" value="${g.id}">
                        <strong style="color: #5865F2; font-size: 13px;">Weryfikacja:</strong>
                        <label style="font-size: 11px; color: #dbdee1;">Kanał:</label>
                        ${makeSelect('channelId', channelOptions, savedConfig.verifyChannel)}
                        <label style="font-size: 11px; color: #dbdee1;">Rola po weryfikacji:</label>
                        ${makeSelect('roleId', roleOptions, savedConfig.verifyRole)}
                        <label style="font-size: 11px; color: #dbdee1;">Nagłówek / Tytuł:</label>
                        <input type="text" name="verifyTitle" value="${savedConfig.verifyTitle || '**Weryfikacja serwera**'}" style="width: 100%; padding: 6px; margin-bottom: 6px; background: #2b2d31; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 12px;">
                        <label style="font-size: 11px; color: #dbdee1;">Treść wiadomości:</label>
                        <textarea name="verifyMsg" style="width: 100%; padding: 6px; margin-bottom: 8px; background: #2b2d31; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 12px; height: 60px;">${savedConfig.verifyMsg || 'Kliknij poniższy przycisk, aby odblokować dostęp.'}</textarea>
                        <button type="submit" style="padding: 6px; font-size: 12px; background: #5865F2; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:bold; width:100%;">Wyślij panel weryfikacji</button>
                    </form>

                    <!-- TICKETY -->
                    <form method="POST" action="/configure-ticket" id="ticketForm_${g.id}">
                        <input type="hidden" name="guildId" value="${g.id}">
                        <strong style="color: #5865F2; font-size: 13px;">Tickety i Uprawnienia:</strong>
                        
                        <label style="font-size: 11px; color: #dbdee1; margin-top: 5px;">Kanał panelu ticketów:</label>
                        ${makeSelect('ticketChannelId', channelOptions, savedConfig.ticketChannel)}
                        
                        <label style="font-size: 11px; color: #dbdee1; margin-top: 5px;">Role obsługujące tickety:</label>
                        <div style="max-height: 90px; overflow-y: auto; background: #2b2d31; padding: 6px; border-radius: 4px; margin-bottom: 8px; border: 1px solid #4e5058;">
                            ${roleCheckboxes || '<span style="font-size:11px; color:#949ba4;">Brak ról</span>'}
                        </div>

                        <label style="font-size: 11px; color: #dbdee1;">Nagłówek embeda:</label>
                        <input type="text" name="ticketTitle" value="${savedConfig.ticketTitle || '**System Zgłoszeń**'}" style="width: 100%; padding: 6px; margin-bottom: 6px; background: #2b2d31; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 12px;">

                        <label style="font-size: 11px; color: #dbdee1;">Treść wiadomości panelu:</label>
                        <textarea name="ticketMessage" style="width: 100%; padding: 6px; margin-bottom: 10px; background: #2b2d31; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 12px; height: 60px;">${savedConfig.ticketMessage || 'Wybierz kategorię zgłoszenia:'}</textarea>

                        <div style="border-top: 1px solid #383a40; padding-top: 8px; margin-bottom: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <strong style="font-size: 11px; color: #b5bac1;">Kategorie i pytania:</strong>
                                <button type="button" onclick="addCategory_${g.id}()" style="background: #23a55a; color: white; border: none; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: bold;">+ Dodaj</button>
                            </div>
                            <div id="categoriesContainer_${g.id}">
                                ${categoriesHtml}
                            </div>
                        </div>

                        <button type="submit" style="padding: 6px; font-size: 12px; background: #23a55a; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:bold; width:100%;">Wyślij / Zaktualizuj panel ticketów</button>
                    </form>
                    <script>
                        function addCategory_${g.id}() {
                            const container = document.getElementById('categoriesContainer_${g.id}');
                            const div = document.createElement('div');
                            div.className = 'category-item';
                            div.style.cssText = 'background: #2b2d31; padding: 10px; border-radius: 4px; margin-bottom: 10px; border: 1px solid #383a40;';
                            div.innerHTML = \`
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                    <span style="font-size: 11px; color: #5865F2; font-weight: bold;">Nowa Kategoria</span>
                                    <button type="button" onclick="this.closest('.category-item').remove()" style="background: #f23f43; color: white; border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 10px;">Usuń</button>
                                </div>
                                <label style="font-size: 10px; color: #949ba4;">Nazwa Kategorii:</label>
                                <input type="text" name="catName[]" required placeholder="np. Skarga" style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 3px; font-size: 11px; margin-bottom: 5px;">
                                <label style="font-size: 10px; color: #949ba4;">Pytanie w formularzu (Modal):</label>
                                <textarea name="catQuestion[]" required placeholder="Podaj szczegóły:" style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 3px; font-size: 11px; resize: vertical; height: 45px;"></textarea>
                            \`;
                            container.appendChild(div);
                        }
                    </script>
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
                    .card { background-color: #2b2d31; padding: 25px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); width: 520px; text-align: left; }
                    h1 { color: #5865F2; text-align: center; font-size: 22px; }
                    h3 { font-size: 15px; margin-top: 0; color: #b5bac1; border-bottom: 1px solid #4e5058; padding-bottom: 8px; }
                    label { display: block; margin-top: 4px; color: #dbdee1; font-size: 12px; }
                    .logout { display: block; text-align: center; margin-top: 20px; color: #f23f43; text-decoration: none; font-weight: bold; }
                    .stat-box { background: #1e1f22; padding: 10px; border-radius: 5px; margin-bottom: 10px; font-size: 14px; }
                    ul { padding-left: 20px; max-height: 150px; overflow-y: auto; font-size: 13px; background: #1e1f22; padding: 10px; border-radius: 5px; }
                    .servers-list { max-height: 650px; overflow-y: auto; padding-right: 5px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="card">
                        <h1>Panel Tivkety</h1>
                        <p style="font-size: 13px; color: #949ba4; text-align: center; margin-bottom: 20px;">Zalogowany: <b>${user.username}</b></p>
                        
                        <h3>Zarządzanie serwerami</h3>
                        <div class="servers-list">
                            ${serversHtml}
                        </div>

                        <a href="/logout" class="logout">Wyloguj się</a>
                    </div>

                    <div class="card">
                        <h1>Statystyki</h1>
                        <h3>Statystyki Bota</h3>
                        <div class="stat-box">Serwery: <b>${totalServers}</b></div>
                        <div class="stat-box">Łącznie użytkowników: <b>${totalUsers}</b></div>

                        <h3 style="margin-top: 20px;">Ostatnie logowania</h3>
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
    const { guildId, channelId, roleId, verifyTitle, verifyMsg } = req.body;

    const guild = clientInstance.guilds.cache.get(guildId);
    if (!guild) return res.send('Nie znaleziono bota na serwerze. <a href="/dashboard">Wróć</a>');

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.send('Nie znaleziono kanału. <a href="/dashboard">Wróć</a>');

    try {
        await saveServerConfig(guildId, { verifyChannel: channelId, verifyRole: roleId, verifyTitle, verifyMsg });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('verify_button').setLabel('Zweryfikuj się').setStyle(ButtonStyle.Success)
        );

        await channel.send({
            content: `${verifyTitle}\n${verifyMsg}`,
            components: [row]
        });

        res.send('<h2>Panel weryfikacyjny wysłany i zapisany!</h2><a href="/dashboard">Wróć do panelu</a>');
    } catch (err) {
        console.error(err);
        res.send('Wystąpił błąd. <a href="/dashboard">Wróć</a>');
    }
});

app.post('/configure-ticket', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');
    const { guildId, ticketChannelId, ticketTitle, ticketMessage } = req.body;
    let supportRoles = req.body.supportRoles || [];
    if (!Array.isArray(supportRoles)) supportRoles = [supportRoles];

    const guild = clientInstance.guilds.cache.get(guildId);
    if (!guild) return res.send('Nie znaleziono bota na serwerze. <a href="/dashboard">Wróć</a>');

    const channel = guild.channels.cache.get(ticketChannelId);
    if (!channel) return res.send('Nie znaleziono kanału ticketów. <a href="/dashboard">Wróć</a>');

    let names = req.body['catName[]'] || [];
    let questions = req.body['catQuestion[]'] || [];
    if (!Array.isArray(names)) names = [names];
    if (!Array.isArray(questions)) questions = [questions];

    const categories = [];
    for (let i = 0; i < names.length; i++) {
        if (names[i] && names[i].trim() !== '') {
            categories.push({
                name: names[i].trim(),
                question: (questions[i] || 'Opisz swój problem:').trim()
            });
        }
    }

    if (categories.length === 0) {
        categories.push({ name: 'Pomoc', question: 'Opisz swój problem:' });
    }

    try {
        await saveServerConfig(guildId, { 
            ticketChannel: ticketChannelId, 
            supportRoles: supportRoles, 
            ticketTitle, 
            ticketMessage,
            ticketCategories: categories 
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket_select_category')
            .setPlaceholder('Wybierz kategorię zgłoszenia...')
            .addOptions(
                categories.map((cat, idx) => ({
                    label: cat.name.substring(0, 25),
                    value: `cat_${idx}`,
                    description: `Otwórz zgłoszenie w kategorii: ${cat.name}`.substring(0, 50)
                }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await channel.send({
            content: `${ticketTitle}\n${ticketMessage}`,
            components: [row]
        });

        res.send('<h2>Panel ticketów zaktualizowany i wysłany!</h2><a href="/dashboard">Wróć do panelu</a>');
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
    new SlashCommandBuilder().setName('weryfikacja').setDescription('Panel weryfikacji'),
    new SlashCommandBuilder().setName('ticket').setDescription('Panel ticketów')
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
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'Brak uprawnień administratora!', ephemeral: true });
        }
        await interaction.reply({ content: 'Użyj panelu internetowego na stronie, aby skonfigurować panele!', ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select_category') {
        const selectedValue = interaction.values[0];
        const catIndex = parseInt(selectedValue.split('_')[1]);

        const config = await getServerConfig(interaction.guild.id);
        const categories = config.ticketCategories || [];
        const category = categories[catIndex] || { name: 'Ogólne', question: 'Opisz swoją sprawę:' };

        const modal = new ModalBuilder()
            .setCustomId(`ticket_modal_${catIndex}`)
            .setTitle(`Zgłoszenie: ${category.name}`.substring(0, 45));

        const answerInput = new TextInputBuilder()
            .setCustomId('ticket_user_answer')
            .setLabel(category.question.substring(0, 45))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(answerInput));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
        const catIndex = parseInt(interaction.customId.split('_')[2]);
        const config = await getServerConfig(interaction.guild.id);
        const categories = config.ticketCategories || [];
        const category = categories[catIndex] || { name: 'Zgłoszenie' };
        
        const userAnswer = interaction.fields.getTextInputValue('ticket_user_answer');
        const guild = interaction.guild;
        const user = interaction.user;

        await interaction.deferReply({ ephemeral: true });

        try {
            const overwrites = [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
            ];

            const supportRoles = config.supportRoles || [];
            supportRoles.forEach(roleId => {
                overwrites.push({
                    id: roleId,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
                });
            });

            const ticketChannel = await guild.channels.create({
                name: `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, ''),
                type: ChannelType.GuildText,
                permissionOverwrites: overwrites,
            });

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('Przejmij ticket 🙋‍♂️').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Zamknij ticket 🔒').setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: `Witaj ${user}!\n**Kategoria:** ${category.name}\n**Odpowiedź na pytanie:**\n> ${userAnswer}\n\n*Administracja wkrótce odpowie.*`,
                components: [actionRow]
            });

            await interaction.editReply({ content: `Utworzono Twój ticket: ${ticketChannel}!` });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: 'Wystąpił błąd podczas tworzenia kanału ticketu.' });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'verify_button') {
            const config = await getServerConfig(interaction.guild.id);
            const verifiedRoleId = config.verifyRole || interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'zweryfikowany')?.id;
            
            if (!verifiedRoleId) return interaction.reply({ content: 'Brak skonfigurowanej roli weryfikacji.', ephemeral: true });

            const verifiedRole = interaction.guild.roles.cache.get(verifiedRoleId);
            const unverifiedRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');

            try {
                if (verifiedRole) await interaction.member.roles.add(verifiedRole);
                if (unverifiedRole) await interaction.member.roles.remove(unverifiedRole);
                await interaction.reply({ content: 'Pomyślnie zweryfikowano!', ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: 'Błąd nadawania ról.', ephemeral: true });
            }
        }

        if (interaction.customId === 'claim_ticket') {
            const config = await getServerConfig(interaction.guild.id);
            const supportRoles = config.supportRoles || [];
            const hasRole = supportRoles.some(roleId => interaction.member.roles.cache.has(roleId));
            const isSupport = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) || hasRole;

            if (!isSupport) {
                return interaction.reply({ content: 'Nie masz uprawnień do przejęcia tego ticketu!', ephemeral: true });
            }

            await interaction.reply({ content: `🙋‍♂️ Ten ticket został przejęty przez **${interaction.user.tag}**.` });
        }

        if (interaction.customId === 'close_ticket') {
            await interaction.reply({ content: 'Zamykanie ticketu za 3 sekundy...' });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
