const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, PermissionsBitField, ChannelType } = require('discord.js');
const express = require('express');
const session = require('express-session');
const admin = require('firebase-admin');
const { setupTicketsRouter, handleTicketInteraction } = require('./tickets');

let db = null;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.trim());
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
        const serviceAccount = require('./serviceAccountKey.json');
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    db = admin.firestore();
    console.log("✅ Połączono z Firebase!");
} catch (e) {
    console.error("❌ Błąd Firebase:", e.message);
}

async function getServerConfig(guildId) {
    if (!db) return {};
    try {
        const docRef = db.collection('server_configs').doc(guildId);
        const doc = await docRef.get();
        if (doc.exists) return doc.data();
    } catch (err) {}
    return {};
}

async function saveServerConfig(guildId, data) {
    if (!db) return;
    try {
        await db.collection('server_configs').doc(guildId).set(data, { merge: true });
    } catch (err) {}
}

const CONFIG = {
    CLIENT_ID: process.env.DISCORD_CLIENT_ID || '1548644251884195880',
    CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || 'emTOywckSfXFKr8xCwWNiJW_6az1IAE0',
    REDIRECT_URI: process.env.DISCORD_REDIRECT_URI || 'https://tivkety.onrender.com/auth/discord/callback',
    PORT: process.env.PORT || 10000,
    SESSION_SECRET: process.env.SESSION_SECRET || 'tajnykluczsosession123'
};

let clientInstance = null;
const app = express();

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json());

app.use(session({
    secret: CONFIG.SESSION_SECRET,
    resave: true,
    saveUninitialized: false,
    proxy: true,
    cookie: { 
        secure: true, 
        maxAge: 30 * 24 * 60 * 60 * 1000 
    }
}));

app.get('/', (req, res) => {
    if (req.session.loggedIn && req.session.user) return res.redirect('/dashboard');

    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;

    res.send(`
        <html>
            <head><title>Logowanie - Tivkety</title><style>body { font-family: Arial; background: #313338; color: #fff; text-align: center; padding-top: 100px; } .card { background: #2b2d31; padding: 40px; border-radius: 10px; display: inline-block; width: 350px; } a { background: #5865F2; color: #fff; padding: 14px; text-decoration: none; border-radius: 5px; display: block; font-weight: bold; }</style></head>
            <body>
                <div class="card">
                    <h1>Panel Tivkety</h1>
                    <p style="color:#949ba4; font-size:13px; margin-bottom:20px;">Zarządzanie ticketami</p>
                    <a href="${discordAuthUrl}">Zaloguj przez Discord</a>
                </div>
            </body>
        </html>
    `);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/?error=no_code');
    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({ client_id: CONFIG.CLIENT_ID, client_secret: CONFIG.CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: CONFIG.REDIRECT_URI }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.redirect('/?error=token');

        const userRes = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${tokenData.access_token}` } });
        const userData = await userRes.json();
        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', { headers: { authorization: `Bearer ${tokenData.access_token}` } });
        const guildsData = await guildsRes.json();

        req.session.loggedIn = true;
        req.session.user = userData;
        req.session.userGuilds = Array.isArray(guildsData) ? guildsData : [];

        res.redirect('/dashboard');
    } catch (err) {
        res.redirect('/?error=server');
    }
});

app.get('/logout', (req, res) => { 
    req.session.destroy(() => res.redirect('/')); 
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.loggedIn || !req.session.user) return res.redirect('/');
    if (!clientInstance || !clientInstance.isReady()) return res.send('Bot się uruchamia... Odśwież za chwilę.');

    const user = req.session.user;
    const adminGuilds = (req.session.userGuilds || []).filter(g => (BigInt(g.permissions) & BigInt(0x8)) === BigInt(0x8) || g.owner);
    let serversHtml = '';

    for (const g of adminGuilds) {
        const botIsIn = clientInstance.guilds.cache.has(g.id);
        const savedConfig = await getServerConfig(g.id);
        
        serversHtml += `<div style="background: #1e1f22; padding: 15px; border-radius: 6px; margin-bottom: 20px; border: 1px solid #383a40;">`;
        serversHtml += `<h4 style="margin: 0 0 10px 0; color: #fff;">🌐 ${g.name}</h4>`;

        if (botIsIn) {
            const guildObj = clientInstance.guilds.cache.get(g.id);
            const channels = guildObj.channels.cache.filter(c => c.type === ChannelType.GuildText);
            const roles = guildObj.roles.cache.filter(r => !r.managed && r.name !== '@everyone');

            let channelOptions = '<option value="">-- Wybierz kanał --</option>';
            channels.forEach(c => { channelOptions += `<option value="${c.id}">#${c.name}</option>`; });

            let ticketModules = savedConfig.ticketModules || [];
            let modulesHtml = '';
            ticketModules.forEach((mod, modIdx) => {
                let roleCheckboxes = '';
                roles.forEach(r => {
                    const isChecked = (mod.supportRoles || []).includes(r.id) ? 'checked' : '';
                    roleCheckboxes += `<label style="display:inline-block; margin-right:8px; font-size:11px; color:#dbdee1;"><input type="checkbox" name="supportRoles" value="${r.id}" ${isChecked} form="modForm_${g.id}_${mod.id}"> @${r.name}</label>`;
                });

                let chSelect = channelOptions.replace(`value="${mod.channelId}"`, `value="${mod.channelId}" selected`);

                let categoriesFlattened = [];
                let catIndexCounter = 0;
                (mod.categories || []).forEach(cat => {
                    const qs = Array.isArray(cat.questions) ? cat.questions : [cat.question || 'Opisz problem:'];
                    qs.forEach(q => {
                        categoriesFlattened.push({ cIndex: catIndexCounter, name: cat.name, question: q });
                    });
                    catIndexCounter++;
                });
                if (categoriesFlattened.length === 0) {
                    categoriesFlattened.push({ cIndex: 0, name: 'Pomoc', question: 'Opisz problem:' });
                }

                modulesHtml += `
                    <div style="background: #2b2d31; padding: 12px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #4e5058;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <strong style="color: #5865F2; font-size: 13px;">Stały Panel #${modIdx + 1}</strong>
                            <form method="POST" action="/delete-ticket-module" style="margin:0;">
                                <input type="hidden" name="guildId" value="${g.id}">
                                <input type="hidden" name="moduleId" value="${mod.id}">
                                <button type="submit" style="background: #f23f43; color: white; border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 10px;">Usuń panel</button>
                            </form>
                        </div>
                        <form method="POST" action="/configure-ticket" id="modForm_${g.id}_${mod.id}">
                            <input type="hidden" name="guildId" value="${g.id}">
                            <input type="hidden" name="moduleId" value="${mod.id}">
                            
                            <label style="font-size: 11px; color: #dbdee1;">Kanał panelu:</label>
                            <select name="ticketChannelId" form="modForm_${g.id}_${mod.id}" required style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 11px; margin-bottom: 6px;">${chSelect}</select>

                            <label style="font-size: 11px; color: #dbdee1;">Role obsługujące:</label>
                            <div style="max-height: 80px; overflow-y: auto; background: #1e1f22; padding: 5px; border-radius: 4px; margin-bottom: 6px; border: 1px solid #4e5058;">${roleCheckboxes}</div>

                            <label style="font-size: 11px; color: #dbdee1;">Nagłówek:</label>
                            <input type="text" name="ticketTitle" value="${(mod.title || '').replace(/"/g, '&quot;')}" style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 11px; margin-bottom: 6px;">

                            <label style="font-size: 11px; color: #dbdee1;">Treść wiadomości:</label>
                            <textarea name="ticketMessage" style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 11px; height: 45px; margin-bottom: 6px;">${mod.message || ''}</textarea>

                            <div id="cats_${g.id}_${mod.id}"></div>
                            <div style="display:flex; gap:5px; margin-bottom: 8px;">
                                <button type="button" onclick="window.addCat_${g.id}_${mod.id}()" style="flex:1; background: #23a55a; color: white; border: none; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 10px; font-weight:bold;">+ Dodaj kategorię</button>
                                <button type="button" onclick="window.addQ_${g.id}_${mod.id}()" style="flex:1; background: #5865F2; color: white; border: none; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 10px; font-weight:bold;">+ Dodaj pytanie do ostatniej</button>
                            </div>

                            <button type="submit" style="width: 100%; background: #23a55a; color: white; border: none; padding: 6px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">Zapisz i aktualizuj stały panel</button>
                        </form>
                        <script>
                            (function() {
                                let flatItems = ${JSON.stringify(categoriesFlattened)};
                                window.renderCats_${g.id}_${mod.id} = function() {
                                    const container = document.getElementById('cats_${g.id}_${mod.id}');
                                    container.innerHTML = '';
                                    flatItems.forEach((item, idx) => {
                                        const d = document.createElement('div');
                                        d.style.cssText = 'background: #1e1f22; padding: 6px; border-radius: 4px; margin-bottom: 5px; border: 1px solid #383a40;';
                                        d.innerHTML = \`
                                            <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="font-size:10px; color:#5865F2;">Kat. ID: \${Number(item.cIndex) + 1}</span><button type="button" onclick="window.remItem_${g.id}_${mod.id}(\${idx})" style="background:#f23f43; color:#fff; border:none; padding:1px 4px; border-radius:2px; font-size:9px; cursor:pointer;">X</button></div>
                                            <input type="hidden" name="catIndex[]" value="\${item.cIndex}" form="modForm_${g.id}_${mod.id}">
                                            <input type="text" name="catName[]" value="\${(item.name || '').replace(/"/g, '&quot;')}" required form="modForm_${g.id}_${mod.id}" placeholder="Nazwa kategorii w menu" style="width:100%; padding:4px; background:#2b2d31; color:#fff; border:1px solid #4e5058; border-radius:3px; font-size:10px; margin-bottom:3px;">
                                            <textarea name="catQuestion[]" required form="modForm_${g.id}_${mod.id}" placeholder="Treść pytania w formularzu" style="width:100%; padding:4px; background:#2b2d31; color:#fff; border:1px solid #4e5058; border-radius:3px; font-size:10px; height:35px;">\${item.question || ''}</textarea>
                                        \`;
                                        container.appendChild(d);
                                    });
                                };
                                window.addCat_${g.id}_${mod.id} = function() { 
                                    const maxC = flatItems.length > 0 ? Math.max(...flatItems.map(i => Number(i.cIndex))) + 1 : 0;
                                    flatItems.push({ cIndex: maxC, name: '', question: '' }); 
                                    window.renderCats_${g.id}_${mod.id}(); 
                                };
                                window.addQ_${g.id}_${mod.id} = function() { 
                                    if (flatItems.length === 0) {
                                        flatItems.push({ cIndex: 0, name: 'Pomoc', question: '' });
                                    } else {
                                        const last = flatItems[flatItems.length - 1];
                                        flatItems.push({ cIndex: last.cIndex, name: last.name, question: '' });
                                    }
                                    window.renderCats_${g.id}_${mod.id}(); 
                                };
                                window.remItem_${g.id}_${mod.id} = function(i) { flatItems.splice(i,1); window.renderCats_${g.id}_${mod.id}(); };
                                window.renderCats_${g.id}_${mod.id}();
                            })();
                        </script>
                    </div>
                `;
            });

            serversHtml += `
                <p style="color: #23a55a; font-size: 12px; margin: 0 0 10px 0;">✔ Bot jest na serwerze</p>
                <form method="POST" action="/configure-ticket" id="newModForm_${g.id}" style="background: #222428; padding: 10px; border-radius: 6px; margin-bottom: 15px; border: 1px dashed #5865F2;">
                    <strong style="color: #5865F2; font-size: 12px; display:block; margin-bottom:6px;">➕ Utwórz nowy stały panel</strong>
                    <input type="hidden" name="guildId" value="${g.id}">
                    <label style="font-size: 10px; color: #dbdee1;">Kanał nowego panelu:</label>
                    <select name="ticketChannelId" form="newModForm_${g.id}" required style="width: 100%; padding: 4px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 11px; margin-bottom: 6px;">${channelOptions}</select>
                    <button type="submit" style="width:100%; background:#5865F2; color:#fff; border:none; padding:5px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:11px;">Stwórz panel</button>
                </form>
                <div style="max-height: 400px; overflow-y: auto;">${modulesHtml}</div>
            `;
        } else {
            const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&permissions=8&scope=bot&guild_id=${g.id}&disable_guild_select=true`;
            serversHtml += `<p style="color: #f0b232; font-size: 12px;">⚠ Bota nie ma na serwerze</p><a href="${inviteUrl}" target="_blank" style="background: #23a55a; color: #fff; padding: 6px; border-radius: 4px; text-decoration: none; display: block; text-align: center; font-size: 12px; font-weight: bold;">Dodaj bota</a>`;
        }
        serversHtml += `</div>`;
    }

    res.send(`
        <html>
            <head><title>Panel Tivkety</title><style>body { font-family: Arial; background: #313338; color: #fff; padding: 20px; text-align: center; } .box { display: inline-block; background: #2b2d31; padding: 20px; border-radius: 8px; width: 550px; text-align: left; }</style></head>
            <body>
                <div class="box">
                    <h2 style="color: #5865F2; text-align:center;">Panel Zarządzania (Zalogowany: ${user.username})</h2>
                    ${serversHtml}
                    <a href="/logout" style="color: #f23f43; text-decoration: none; font-weight: bold; display: block; text-align: center; margin-top: 15px;">Wyloguj się</a>
                </div>
            </body>
        </html>
    `);
});

setupTicketsRouter(app, getServerConfig, saveServerConfig, () => clientInstance);
app.listen(CONFIG.PORT, () => console.log(`Serwer HTTP działa na porcie ${CONFIG.PORT}`));

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
clientInstance = client;

client.once('ready', async () => {
    console.log(`Zalogowano jako ${client.user.tag}!`);

    // Rejestracja globalnej komendy /ticket z podpowiedziami (Autocomplete)
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commands = [
        new SlashCommandBuilder()
            .setName('ticket')
            .setDescription('Zarządzanie systemem zgłoszeń')
            .addSubcommand(sub =>
                sub.setName('panel')
                    .setDescription('Wysyła panel zgłoszeń na ten kanał')
                    .addStringOption(option =>
                        option.setName('panel')
                            .setDescription('Wybierz panel do wysłania')
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
            )
    ];

    try {
        await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands });
        console.log('✅ Pomyślnie zarejestrowano komendę /ticket z autouzupełnianiem!');
    } catch (error) {
        console.error('Błąd rejestracji komend:', error);
    }
});

client.on('interactionCreate', async interaction => {
    await handleTicketInteraction(interaction, getServerConfig);
});

client.login(process.env.DISCORD_TOKEN);
