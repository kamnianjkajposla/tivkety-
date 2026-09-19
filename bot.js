const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, REST, Routes, ChannelType, EmbedBuilder, PermissionsBitField } = require('discord.js');
const express = require('express');
const session = require('express-session');
const admin = require('firebase-admin');

// --- 1. Konfiguracja Firebase ---
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
    console.log("✅ Połączono z bazą Firebase!");
} catch (e) {
    console.error("❌ Błąd inicjalizacji Firebase:", e.message);
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

// --- 2. Konfiguracja Aplikacji ---
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
    cookie: { secure: true, maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// --- 3. Panel WWW & Endpointy ---
app.get('/', (req, res) => {
    if (req.session.loggedIn && req.session.user) return res.redirect('/dashboard');
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;

    res.send(`
        <html>
            <head><title>Logowanie - Tivkety</title><style>body { font-family: Arial; background: #313338; color: #fff; text-align: center; padding-top: 100px; } .card { background: #2b2d31; padding: 40px; border-radius: 10px; display: inline-block; width: 350px; } a { background: #5865F2; color: #fff; padding: 14px; text-decoration: none; border-radius: 5px; display: block; font-weight: bold; }</style></head>
            <body>
                <div class="card">
                    <h1>Panel Tivkety</h1>
                    <p style="color:#949ba4; font-size:13px; margin-bottom:20px;">Zarządzanie systemem zgłoszeń</p>
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

// Endpoint konfiguracji paneli (bez obrazków)
app.post('/configure-ticket', async (req, res) => {
    if (!req.session.loggedIn || !req.session.user) return res.redirect('/');
    const guildId = req.body.guildId;
    if (!guildId) return res.status(400).send('Brak ID serwera');

    const config = await getServerConfig(guildId);
    if (!config.ticketModules) config.ticketModules = [];

    let moduleId = req.body.moduleId;
    let targetModule;

    if (!moduleId) {
        moduleId = 'mod_' + Date.now();
        targetModule = {
            id: moduleId,
            channelId: req.body.ticketChannelId || '',
            title: '🎫 Centrum Pomocy',
            message: 'Kliknij przycisk poniżej, aby otworzyć zgłoszenie.',
            supportRoles: [],
            categories: [{ name: 'Ogólne', questions: ['Opisz swój problem:'] }]
        };
        config.ticketModules.push(targetModule);
    } else {
        targetModule = config.ticketModules.find(m => m.id === moduleId);
        if (targetModule) {
            targetModule.channelId = req.body.ticketChannelId || targetModule.channelId;
            targetModule.title = req.body.ticketTitle || targetModule.title;
            targetModule.message = req.body.ticketMessage || targetModule.message;
            
            let roles = req.body.supportRoles;
            targetModule.supportRoles = Array.isArray(roles) ? roles : (roles ? [roles] : []);

            const cIndexes = req.body['catIndex[]'];
            const cNames = req.body['catName[]'];
            const cQuestions = req.body['catQuestion[]'];

            if (cNames) {
                const indexes = Array.isArray(cIndexes) ? cIndexes : [cIndexes];
                const names = Array.isArray(cNames) ? cNames : [cNames];
                const questions = Array.isArray(cQuestions) ? cQuestions : [cQuestions];

                const catMap = {};
                names.forEach((name, idx) => {
                    const cIdx = indexes[idx] || '0';
                    if (!catMap[cIdx]) {
                        catMap[cIdx] = { name: name, questions: [] };
                    }
                    if (questions[idx]) {
                        catMap[cIdx].questions.push(questions[idx]);
                    }
                });
                targetModule.categories = Object.values(catMap);
            }
        }
    }

    await saveServerConfig(guildId, config);
    res.redirect('/dashboard');
});

app.post('/delete-ticket-module', async (req, res) => {
    if (!req.session.loggedIn || !req.session.user) return res.redirect('/');
    const { guildId, moduleId } = req.body;
    if (guildId && moduleId) {
        const config = await getServerConfig(guildId);
        if (config.ticketModules) {
            config.ticketModules = config.ticketModules.filter(m => m.id !== moduleId);
            await saveServerConfig(guildId, config);
        }
    }
    res.redirect('/dashboard');
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.loggedIn || !req.session.user) return res.redirect('/');
    if (!clientInstance || !clientInstance.isReady()) return res.send('Bot się uruchamia... Odśwież stronę za kilka sekund.');

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
                        <form method="POST" action="/configure-ticket" id="modForm_${g.id}_${mod.id}">
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
                <form method="POST" action="/configure-ticket" id="newModForm_${g.id}" style="background: #222428; padding: 10px; border-radius: 6px; margin-bottom: 15px; border: 1px dashed #5865F2;">
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

// --- 4. Logika Bota Discord ---
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
clientInstance = client;

client.once('ready', async () => {
    console.log(`🤖 Zalogowano jako ${client.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commands = [
        new SlashCommandBuilder()
            .setName('ticket')
            .setDescription('Zarządzanie systemem zgłoszeń')
            .addSubcommand(sub =>
                sub.setName('panel')
                    .setDescription('Wysyła panel zgłoszeń na ten kanał')
                    .addStringOption(option =>
                        option.setName('panel_id')
                            .setDescription('Wybierz panel')
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
            )
    ];

    try {
        await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands });
        console.log('✅ Zarejestrowano komendę /ticket');
    } catch (error) {
        console.error('Błąd rejestracji komend:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'ticket') {
            const config = await getServerConfig(interaction.guildId);
            const modules = config.ticketModules || [];
            const choices = modules.map((m, idx) => ({
                name: `Panel #${idx + 1}: ${(m.title || 'Panel').substring(0, 50)}`,
                value: m.id
            }));
            await interaction.respond(choices.slice(0, 25));
        }
        return;
    }

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'ticket') {
            const sub = interaction.options.getSubcommand();
            if (sub === 'panel') {
                const moduleId = interaction.options.getString('panel_id');
                const config = await getServerConfig(interaction.guildId);
                const modules = config.ticketModules || [];
                const mod = modules.find(m => m.id === moduleId);

                if (!mod) {
                    return interaction.reply({ content: '❌ Nie znaleziono takiego panelu w bazie!', ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setTitle(mod.title || 'Centrum Pomocy')
                    .setDescription(mod.message || 'Kliknij przycisk poniżej, aby otworzyć ticket.')
                    .setColor('#5865F2');

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`open_ticket_${mod.id}`)
                        .setLabel('Stwórz zgłoszenie')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎫')
                );

                const channel = interaction.guild.channels.cache.get(mod.channelId) || interaction.channel;
                await channel.send({ embeds: [embed], components: [row] });
                await interaction.reply({ content: `✅ Wysłano panel zgłoszeń na kanał ${channel}!`, ephemeral: true });
            }
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('open_ticket_')) {
        const moduleId = interaction.customId.replace('open_ticket_', '');
        const config = await getServerConfig(interaction.guildId);
        const modules = config.ticketModules || [];
        const mod = modules.find(m => m.id === moduleId);

        if (!mod) {
            return interaction.reply({ content: '❌ Ten panel zgłoszeń został usunięty lub zaktualizowany.', ephemeral: true });
        }

        const categories = mod.categories || [{ name: 'Pomoc', questions: ['Opisz problem:'] }];
        
        if (categories.length === 1) {
            const cat = categories[0];
            const modal = new ModalBuilder()
                .setCustomId(`modal_ticket_${moduleId}_0`)
                .setTitle(`Ticket: ${cat.name.substring(0, 30)}`);

            const qs = Array.isArray(cat.questions) ? cat.questions : [cat.question || 'Opisz problem:'];
            qs.slice(0, 5).forEach((q, qIdx) => {
                const textInput = new TextInputBuilder()
                    .setCustomId(`q_${qIdx}`)
                    .setLabel(q.substring(0, 45))
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(textInput));
            });

            await interaction.showModal(modal);
        } else {
            const row = new ActionRowBuilder();
            categories.slice(0, 5).forEach((cat, cIdx) => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`sel_cat_${moduleId}_${cIdx}`)
                        .setLabel(cat.name.substring(0, 80))
                        .setStyle(ButtonStyle.Secondary)
                );
            });
            await interaction.reply({ content: 'Wybierz kategorię zgłoszenia:', components: [row], ephemeral: true });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('sel_cat_')) {
        const parts = interaction.customId.split('_');
        const moduleId = parts[2];
        const catIdx = parseInt(parts[3]);

        const config = await getServerConfig(interaction.guildId);
        const modules = config.ticketModules || [];
        const mod = modules.find(m => m.id === moduleId);
        if (!mod || !mod.categories || !mod.categories[catIdx]) {
            return interaction.update({ content: '❌ Wybrana kategoria już nie istnieje.', components: [] });
        }

        const cat = mod.categories[catIdx];
        const modal = new ModalBuilder()
            .setCustomId(`modal_ticket_${moduleId}_${catIdx}`)
            .setTitle(`Ticket: ${cat.name.substring(0, 30)}`);

        const qs = Array.isArray(cat.questions) ? cat.questions : ['Opisz problem:'];
        qs.slice(0, 5).forEach((q, qIdx) => {
            const textInput = new TextInputBuilder()
                .setCustomId(`q_${qIdx}`)
                .setLabel(q.substring(0, 45))
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(textInput));
        });

        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ticket_')) {
        const parts = interaction.customId.split('_');
        const moduleId = parts[2];
        const catIdx = parseInt(parts[3]);

        const config = await getServerConfig(interaction.guildId);
        const modules = config.ticketModules || [];
        const mod = modules.find(m => m.id === moduleId);
        if (!mod) return interaction.reply({ content: '❌ Błąd konfiguracji panelu.', ephemeral: true });

        const cat = (mod.categories && mod.categories[catIdx]) ? mod.categories[catIdx] : { name: 'Pomoc', questions: [] };

        const guild = interaction.guild;
        const supportRoles = mod.supportRoles || [];
        
        const permissionOverwrites = [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ];

        supportRoles.forEach(roleId => {
            permissionOverwrites.push({ id: roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
        });

        const ticketChannel = await guild.channels.create({
            name: `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 25),
            type: ChannelType.GuildText,
            permissionOverwrites: permissionOverwrites
        });

        let answersHtml = '';
        const qs = Array.isArray(cat.questions) ? cat.questions : ['Opisz problem:'];
        qs.forEach((q, qIdx) => {
            const val = interaction.fields.getTextInputValue(`q_${qIdx}`) || 'Brak odpowiedzi';
            answersHtml += `**${q}**\n${val}\n\n`;
        });

        const ticketEmbed = new EmbedBuilder()
            .setTitle(`Zgłoszenie: ${cat.name}`)
            .setDescription(`Witaj ${interaction.user}!\n\n${answersHtml}`)
            .setColor('#23a55a')
            .setTimestamp();

        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Zamknij ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒')
        );

        await ticketChannel.send({ content: `${interaction.user} ${supportRoles.map(r => `<@&${r}>`).join(' ')}`, embeds: [ticketEmbed], components: [closeRow] });
        await interaction.reply({ content: `✅ Utworzono zgłoszenie: ${ticketChannel}`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        await interaction.reply({ content: '🔒 Zamykanie ticketu za 5 sekund...' });
        setTimeout(() => {
            interaction.channel.delete().catch(() => {});
        }, 5000);
    }
});

// --- 5. Uruchomienie aplikacji ---
app.listen(CONFIG.PORT, () => console.log(`🚀 Serwer HTTP działa na porcie ${CONFIG.PORT}`));
client.login(process.env.DISCORD_TOKEN);
