const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, PermissionsBitField, ChannelType } = require('discord.js');
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

// ==========================================
// ⚙️ KONFIGURACJA OAUTH2 (DISCORD LOGIN)
// ==========================================
const CONFIG = {
    CLIENT_ID: process.env.DISCORD_CLIENT_ID || '1548644251884195880',
    CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || 'emTOywckSfXFKr8xCwWNiJW_6az1IAE0',
    REDIRECT_URI: process.env.DISCORD_REDIRECT_URI || 'https://tivkety.onrender.com/auth/discord/callback',
    PORT: process.env.PORT || 10000,
    SESSION_SECRET: process.env.SESSION_SECRET || 'tajnykluczsosession123'
};

// --- BAZA DANYCH W PLIKU (ZAPIS PO ZAMKNIĘCIU) ---
const DB_FILE = path.join(__dirname, 'database.json');

function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Błąd odczytu bazy danych:', err);
    }
    return {};
}

function saveDatabase(db) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
        console.error('Błąd zapisu bazy danych:', err);
    }
}

const serverConfigs = loadDatabase(); 
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

app.get('/dashboard', (req, res) => {
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
        adminGuilds.forEach(g => {
            const botIsInGuild = clientInstance.guilds.cache.has(g.id);
            const savedConfig = serverConfigs[g.id] || {};
            
            serversHtml += `<div style="background: #1e1f22; padding: 15px; border-radius: 6px; margin-bottom: 15px;">`;
            serversHtml += `<h4 style="margin: 0 0 10px 0; color: #fff; font-size: 15px;">🌐 ${g.name}</h4>`;

            if (botIsInGuild) {
                serversHtml += `
                    <p style="color: #23a55a; font-size: 12px; margin: 0 0 10px 0;">✔ Bot jest na tym serwerze</p>
                    <form method="POST" action="/configure">
                        <input type="hidden" name="guildId" value="${g.id}">
                        <label style="font-size: 12px; color: #dbdee1;">ID kanału weryfikacji:</label>
                        <input type="text" name="channelId" value="${savedConfig.channelId || ''}" placeholder="np. 123456789..." required style="margin-bottom: 8px;">
                        
                        <label style="font-size: 12px; color: #dbdee1;">ID roli po weryfikacji:</label>
                        <input type="text" name="roleId" value="${savedConfig.roleId || ''}" placeholder="np. 987654321..." required style="margin-bottom: 10px;">
                        
                        <button type="submit" style="margin-top: 0; padding: 8px; font-size: 13px;">Zapisz i wyślij panel weryfikacji</button>
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
        });
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
                    .card { background-color: #2b2d31; padding: 25px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); width: 450px; text-align: left; }
                    h1 { color: #5865F2; text-align: center; font-size: 22px; }
                    h3 { font-size: 16px; margin-top: 0; color: #b5bac1; border-bottom: 1px solid #4e5058; padding-bottom: 8px; }
                    label { display: block; margin-top: 6px; color: #dbdee1; font-size: 13px; }
                    input { width: 100%; padding: 7px; margin-top: 3px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; box-sizing: border-box; }
                    button { width: 100%; background: #5865F2; color: #fff; padding: 9px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
                    button:hover { background: #4752c4; }
                    .logout { display: block; text-align: center; margin-top: 20px; color: #f23f43; text-decoration: none; font-weight: bold; }
                    .stat-box { background: #1e1f22; padding: 10px; border-radius: 5px; margin-bottom: 10px; font-size: 14px; }
                    ul { padding-left: 20px; max-height: 150px; overflow-y: auto; font-size: 13px; background: #1e1f22; padding: 10px; border-radius: 5px; }
                    .servers-list { max-height: 500px; overflow-y: auto; padding-right: 5px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="card">
                        <h1>Panel Tivkety</h1>
                        <p style="font-size: 13px; color: #949ba4; text-align: center; margin-bottom: 20px;">Zalogowany: <b>${user.username}</b></p>
                        
                        <h3>Twoje serwery administracyjne</h3>
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

app.post('/configure', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');
    const { guildId, channelId, roleId } = req.body;

    const guild = clientInstance.guilds.cache.get(guildId);
    if (!guild) return res.send('Nie znaleziono bota na tym serwerze. <a href="/dashboard">Wróć</a>');

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.send('Nie znaleziono kanału o podanym ID na tym serwerze. <a href="/dashboard">Wróć</a>');

    try {
        if (!serverConfigs[guildId]) serverConfigs[guildId] = {};
        serverConfigs[guildId].channelId = channelId;
        serverConfigs[guildId].roleId = roleId;
        saveDatabase(serverConfigs);

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

        res.send('<h2>Panel weryfikacyjny został wysłany, a ustawienia zapisane!</h2><a href="/dashboard">Wróć do panelu</a>');
    } catch (err) {
        console.error(err);
        res.send('Wystąpił błąd. Upewnij się, że bot ma uprawnienia do pisania na tym kanale. <a href="/dashboard">Wróć</a>');
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

// Rejestracja komend Slash (/weryfikacja oraz /ticket)
const commands = [
    new SlashCommandBuilder()
        .setName('weryfikacja')
        .setDescription('Wysyła panel weryfikacyjny na wyznaczony kanał')
        .addChannelOption(option => 
            option.setName('kanal')
                .setDescription('Kanał, na który ma trafić panel weryfikacji')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('rola')
                .setDescription('Rola nadawana po udanej weryfikacji')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Wysyła panel tworzenia zgłoszeń (ticketów)')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Kanał, na którym ma pojawić się panel ticketów')
                .setRequired(true))
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Zalogowano jako ${client.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Rozpoczęto rejestrację komend slash.');
        await rest.put(
            Routes.applicationCommands(CONFIG.CLIENT_ID),
            { body: commands },
        );
        console.log('Pomyślnie zarejestrowano komendy slash.');
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
        console.error('Błąd podczas nadawania roli Niezweryfikowany:', error);
    }
});

client.on('interactionCreate', async interaction => {
    // 1. Obsługa Komend Slash
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'weryfikacja') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'Musisz być administratorem, aby użyć tej komendy!', ephemeral: true });
            }

            const channel = interaction.options.getChannel('kanal');
            const role = interaction.options.getRole('rola');
            const guildId = interaction.guild.id;

            if (!serverConfigs[guildId]) serverConfigs[guildId] = {};
            serverConfigs[guildId].channelId = channel.id;
            serverConfigs[guildId].roleId = role.id;
            saveDatabase(serverConfigs);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_button')
                    .setLabel('Zweryfikuj się')
                    .setStyle(ButtonStyle.Success)
            );

            try {
                await channel.send({
                    content: '**Weryfikacja serwera**\nKliknij poniższy przycisk, aby odblokować dostęp do całego serwera:',
                    components: [row]
                });
                await interaction.reply({ content: `Pomyślnie wysłano panel weryfikacyjny na kanał ${channel}!`, ephemeral: true });
            } catch (err) {
                console.error(err);
                await interaction.reply({ content: 'Wystąpił błąd podczas wysyłania panelu.', ephemeral: true });
            }
        }

        if (interaction.commandName === 'ticket') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'Musisz być administratorem, aby użyć tej komendy!', ephemeral: true });
            }

            const channel = interaction.options.getChannel('kanal');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel('Stwórz ticket 🎫')
                    .setStyle(ButtonStyle.Primary)
            );

            try {
                await channel.send({
                    content: '**System Zgłoszeń (Tickety)**\nKliknij przycisk poniżej, aby otworzyć prywatny kanał zgłoszenia z administracją:',
                    components: [row]
                });
                await interaction.reply({ content: `Pomyślnie wysłano panel ticketów na kanał ${channel}!`, ephemeral: true });
            } catch (err) {
                console.error(err);
                await interaction.reply({ content: 'Wystąpił błąd podczas wysyłania panelu ticketów.', ephemeral: true });
            }
        }
    }

    // 2. Obsługa Przycisków (Weryfikacja oraz Tickety)
    if (interaction.isButton()) {
        // Przycisk weryfikacji
        if (interaction.customId === 'verify_button') {
            const guildId = interaction.guild.id;
            const config = serverConfigs[guildId] || {};
            let verifiedRoleId = config.roleId;
            
            if (!verifiedRoleId) {
                const fallbackRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'zweryfikowany');
                if (fallbackRole) {
                    verifiedRoleId = fallbackRole.id;
                } else {
                    return interaction.reply({ content: 'Weryfikacja nie została jeszcze skonfigurowana dla tego serwera.', ephemeral: true });
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

        // Przycisk tworzenia ticketu
        if (interaction.customId === 'create_ticket') {
            const guild = interaction.guild;
            const user = interaction.user;

            try {
                await interaction.deferReply({ ephemeral: true });

                // Tworzenie prywatnego kanału dla użytkownika
                const ticketChannel = await guild.channels.create({
                    name: `ticket-${user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: guild.id, // Ukryj dla wszystkich
                            deny: [PermissionsBitField.Flags.ViewChannel],
                        },
                        {
                            id: user.id, // Pokaż dla użytkownika, który kliknął
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
                        },
                        {
                            id: client.user.id, // Pokaż dla bota
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels],
                        }
                    ],
                });

                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Zamknij ticket 🔒')
                        .setStyle(ButtonStyle.Danger)
                );

                await ticketChannel.send({
                    content: `Witaj ${user}! Administracja wkrótce Ci pomoże.\nAby zamknąć to zgłoszenie, kliknij przycisk poniżej:`,
                    components: [closeRow]
                });

                await interaction.editReply({ content: `Utworzono Twój ticket: ${ticketChannel}!` });
            } catch (err) {
                console.error(err);
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.reply({ content: 'Wystąpił błąd podczas tworzenia kanału ticketu.', ephemeral: true });
                } else {
                    await interaction.editReply({ content: 'Wystąpił błąd podczas tworzenia kanału ticketu.' });
                }
            }
        }

        // Przycisk zamykania ticketu
        if (interaction.customId === 'close_ticket') {
            try {
                await interaction.reply({ content: 'Zamykanie ticketu za 3 sekundy...' });
                setTimeout(async () => {
                    await interaction.channel.delete().catch(() => {});
                }, 3000);
            } catch (err) {
                console.error(err);
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
