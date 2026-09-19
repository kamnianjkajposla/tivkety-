const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, PermissionsBitField, ChannelType } = require('discord.js');
const express = require('express');
const session = require('express-session');
const admin = require('firebase-admin');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
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
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

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
                    <p style="color:#949ba4; font-size:13px; margin-bottom:20px;">Zarządzanie ticketami i weryfikacją</p>
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

// Poprawiona obsługa Multera – bezpieczne przetwarzanie plików i linków
app.post('/configure-ticket', (req, res, next) => {
    upload.single('ticketImageFile')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).send('<div style="font-family: Arial; background: #313338; color: #fff; text-align: center; padding: 50px;"><h2 style="color: #f23f43;">❌ Błąd: Za duży plik!</h2><p>Maksymalny rozmiar to 8 MB.</p><a href="/dashboard" style="color: #5865F2; font-weight: bold; text-decoration: none;">Wróć</a></div>');
            }
            return res.status(400).send(`<div style="font-family: Arial; background: #313338; color: #fff; text-align: center; padding: 50px;"><h2 style="color: #f23f43;">❌ Błąd pliku:</h2><p>${err.message}</p><a href="/dashboard" style="color: #5865F2; font-weight: bold; text-decoration: none;">Wróć</a></div>`);
        } else if (err) {
            return res.status(500).send(`<div style="font-family: Arial; background: #313338; color: #fff; text-align: center; padding: 50px;"><h2 style="color: #f23f43;">❌ Błąd serwera:</h2><p>${err.message}</p><a href="/dashboard" style="color: #5865F2; font-weight: bold; text-decoration: none;">Wróć</a></div>`);
        }

        if (req.file) {
            const b64 = Buffer.from(req.file.buffer).toString('base64');
            req.body.ticketImageText = `data:${req.file.mimetype};base64,${b64}`;
        } else {
            req.body.ticketImageText = req.body.ticketImageURL || '';
        }
        next();
    });
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
            let modulesHtml = `<div style="margin-bottom: 12px;"><strong style="color: #5865F2; font-size: 12px;">📋 Lista aktywnych paneli (${ticketModules.length}):</strong></div>`;
            
            ticketModules.forEach((mod, modIdx) => {
                let roleCheckboxes = '';
                roles.forEach(r => {
                    const isChecked = (mod.supportRoles || []).includes(r.id) ? 'checked' : '';
                    roleCheckboxes += `<label style="display:inline-block; margin-right:8px; font-size:11px; color:#dbdee1;"><input type="checkbox" name="supportRoles" value="${r.id}" ${isChecked} form="modForm_${g.id}_${mod.id}"> @${r.name}</label>`;
                });

                let chSelect = channelOptions.replace(`value="${mod.channelId}"`, `value="${mod.channelId}" selected`);

                let currentUrlVal = '';
                let currentImgVal = mod.image || '';
                if (currentImgVal.startsWith('http://') || currentImgVal.startsWith('https://')) {
                    currentUrlVal = currentImgVal;
                }

                let categoriesGrouped = [];
                (mod.categories || []).forEach((cat, cIdx) => {
                    const qs = Array.isArray(cat.questions) ? cat.questions : [cat.question || 'Opisz problem:'];
                    qs.forEach(q => {
                        categoriesGrouped.push({ cIndex: cIdx, name: cat.name, question: q });
                    });
                });
                if (categoriesGrouped.length === 0) {
                    categoriesGrouped.push({ cIndex: 0, name: 'Pomoc', question: 'Opisz problem:' });
                }

                modulesHtml += `
                    <div style="background: #2b2d31; padding: 12px; border-radius: 6px; margin-bottom: 15px; border: 1px solid #4e5058;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <strong style="color: #23a55a; font-size: 13px;">Panel #${modIdx + 1}: ${(mod.title || 'Panel').replace(/\*/g, '')}</strong>
                            <form method="POST" action="/delete-ticket-module" style="margin:0;">
                                <input type="hidden" name="guildId" value="${g.id}">
                                <input type="hidden" name="moduleId" value="${mod.id}">
                                <button type="submit" style="background: #f23f43; color: white; border: none; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 10px; font-weight:bold;">🗑️ Usuń panel</button>
                            </form>
                        </div>
                        <form method="POST" action="/configure-ticket" enctype="multipart/form-data" id="modForm_${g.id}_${mod.id}">
                            <input type="hidden" name="guildId" value="${g.id}">
                            <input type="hidden" name="moduleId" value="${mod.id}">
                            
                            <label style="font-size: 11px; color: #dbdee1;">Kanał panelu:</label>
                            <select name="ticketChannelId" required style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 11px; margin-bottom: 6px;">${chSelect}</select>

                            <label style="font-size: 11px; color: #dbdee1;">Role obsługujące:</label>
                            <div style="max-height: 80px; overflow-y: auto; background: #1e1f22; padding: 5px; border-radius: 4px; margin-bottom: 6px; border: 1px solid #4e5058;">${roleCheckboxes}</div>

                            <label style="font-size: 11px; color: #dbdee1;">Nagłówek panelu:</label>
                            <input type="text" name="ticketTitle" value="${(mod.title || '').replace(/"/g, '&quot;')}" style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 11px; margin-bottom: 6px;">

                            <label style="font-size: 11px; color: #dbdee1;">Treść wiadomości:</label>
                            <textarea name="ticketMessage" style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 11px; height: 45px; margin-bottom: 6px;">${mod.message || ''}</textarea>

                            <label style="font-size: 11px; color: #dbdee1;">Wklej link do obrazka (URL):</label>
                            <input type="url" name="ticketImageURL" value="${currentUrlVal}" placeholder="https://..." style="width: 100%; padding: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 11px; margin-bottom: 6px;">

                            <label style="font-size: 11px; color: #dbdee1;">LUB wgraj plik z komputera:</label>
                            <input type="file" name="ticketImageFile" accept="image/*" style="width: 100%; padding: 4px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 10px; margin-bottom: 6px;">

                            <label style="font-size: 11px; color: #dbdee1; font-weight:bold; display:block; margin-top:5px;">Kategorie i pytania:</label>
                            <div id="cats_${g.id}_${mod.id}"></div>
                            
                            <div style="display:flex; gap:5px; margin-bottom: 8px; margin-top:5px;">
                                <button type="button" onclick="window.addCat_${g.id}_${mod.id}()" style="flex:1; background: #23a55a; color: white; border: none; padding: 5px; border-radius: 3px; cursor: pointer; font-size: 10px; font-weight:bold;">+ Dodaj kategorię</button>
                                <button type="button" onclick="window.addQ_${g.id}_${mod.id}()" style="flex:1; background: #5865F2; color: white; border: none; padding: 5px; border-radius: 3px; cursor: pointer; font-size: 10px; font-weight:bold;">+ Dodaj pytanie do kat.</button>
                            </div>

                            <button type="submit" style="width: 100%; background: #5865F2; color: white; border: none; padding: 6px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">💾 Zapisz zmiany w panelu</button>
                        </form>
                        <script>
                            (function() {
                                let flatItems = ${JSON.stringify(categoriesGrouped)};
                                window.renderCats_${g.id}_${mod.id} = function() {
                                    const container = document.getElementById('cats_${g.id}_${mod.id}');
                                    container.innerHTML = '';
                                    flatItems.forEach((item, idx) => {
                                        const d = document.createElement('div');
                                        d.style.cssText = 'background: #1e1f22; padding: 6px; border-radius: 4px; margin-bottom: 5px; border: 1px solid #383a40;';
                                        d.innerHTML = \`
                                            <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="font-size:10px; color:#5865F2;">Kategoria ID: \${Number(item.cIndex) + 1}</span><button type="button" onclick="window.remItem_${g.id}_${mod.id}(\${idx})" style="background:#f23f43; color:#fff; border:none; padding:1px 4px; border-radius:2px; font-size:9px; cursor:pointer;">X</button></div>
                                            <input type="hidden" name="catIndex[]" value="\${item.cIndex}">
                                            <input type="text" name="catName[]" value="\${(item.name || '').replace(/"/g, '&quot;')}" required placeholder="Nazwa kategorii" style="width:100%; padding:4px; background:#2b2d31; color:#fff; border:1px solid #4e5058; border-radius:3px; font-size:10px; margin-bottom:3px;">
                                            <textarea name="catQuestion[]" required placeholder="Pytanie" style="width:100%; padding:4px; background:#2b2d31; color:#fff; border:1px solid #4e5058; border-radius:3px; font-size:10px; height:35px;">\${item.question || ''}</textarea>
                                        \`;
                                        const inputs = d.querySelectorAll('input, textarea');
                                        inputs.forEach(inp => inp.setAttribute('form', 'modForm_${g.id}_${mod.id}'));
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
                <form method="POST" action="/configure-ticket" enctype="multipart/form-data" id="newModForm_${g.id}" style="background: #222428; padding: 10px; border-radius: 6px; margin-bottom: 15px; border: 1px dashed #5865F2;">
                    <strong style="color: #5865F2; font-size: 12px; display:block; margin-bottom:6px;">➕ Stwórz nowy panel ticketów</strong>
                    <input type="hidden" name="guildId" value="${g.id}">
                    <label style="font-size: 10px; color: #dbdee1;">Kanał nowego panelu:</label>
                    <select name="ticketChannelId" required style="width: 100%; padding: 4px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; font-size: 11px; margin-bottom: 6px;">${channelOptions}</select>
                    <button type="submit" style="width:100%; background:#23a55a; color:#fff; border:none; padding:6px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:11px;">Utwórz nowy panel</button>
                </form>
                <div style="max-height: 500px; overflow-y: auto;">${modulesHtml}</div>
            `;
        } else {
            const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&permissions=8&scope=bot&guild_id=${g.id}&disable_guild_select=true`;
            serversHtml += `<p style="color: #f0b232; font-size: 12px;">⚠ Bota nie ma na serwerze</p><a href="${inviteUrl}" target="_blank" style="background: #23a55a; color: #fff; padding: 6px; border-radius: 4px; text-decoration: none; display: block; text-align: center; font-size: 12px; font-weight: bold;">Dodaj bota</a>`;
        }
        serversHtml += `</div>`;
    }

    res.send(`
        <html>
            <head><title>Panel Tivkety</title><style>body { font-family: Arial; background: #313338; color: #fff; padding: 20px; text-align: center; } .box { display: inline-block; background: #2b2d31; padding: 20px; border-radius: 8px; width: 600px; text-align: left; }</style></head>
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
            ),
        new SlashCommandBuilder()
            .setName('weryfikacja')
            .setDescription('Konfiguracja systemu weryfikacji')
            .addChannelOption(option =>
                option.setName('kanal')
                    .setDescription('Kanał weryfikacji')
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildText)
            )
            .addRoleOption(option =>
                option.setName('rola_po_weryfikacji')
                    .setDescription('Rola nadawana po udanej weryfikacji')
                    .setRequired(true)
            )
            .addChannelOption(option =>
                option.setName('kanal_po_weryfikacji')
                    .setDescription('Kanał docelowy po weryfikacji (opcjonalnie)')
                    .setRequired(false)
                    .addChannelTypes(ChannelType.GuildText)
            )
    ];

    try {
        await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands });
        console.log('✅ Pomyślnie zarejestrowano komendy /ticket oraz /weryfikacja!');
    } catch (error) {
        console.error('Błąd rejestracji komend:', error);
    }
});

client.on('guildMemberAdd', async member => {
    try {
        let unverifiedRole = member.guild.roles.cache.find(r => r.name === 'Niezweryfikowany');
        if (!unverifiedRole) {
            unverifiedRole = await member.guild.roles.create({
                name: 'Niezweryfikowany',
                color: '#99aab5',
                permissions: []
            });

            const config = await getServerConfig(member.guild.id);
            const verifyChannelId = config.verification ? config.verification.channelId : null;

            member.guild.channels.cache.forEach(async (channel) => {
                if (verifyChannelId && channel.id === verifyChannelId) {
                    await channel.permissionOverwrites.create(unverifiedRole, { ViewChannel: true, SendMessages: true });
                } else {
                    await channel.permissionOverwrites.create(unverifiedRole, { ViewChannel: false });
                }
            });
        }
        await member.roles.add(unverifiedRole);
    } catch (err) {
        console.error('Błąd podczas dodawania roli niezweryfikowanego:', err);
    }
});

client.on('interactionCreate', async interaction => {
    await handleTicketInteraction(interaction, getServerConfig, saveServerConfig);
});

client.login(process.env.DISCORD_TOKEN);
