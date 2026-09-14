const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');

// --- KONFIGURACJA OAUTH2 (UZupełnij swoimi danymi z Discord Developer Portal) ---
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;       // ID aplikacji z Developer Portal
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET; // Secret z Developer Portal
const REDIRECT_URI = process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/auth/discord/callback` : 'http://localhost:10000/auth/discord/callback';

// --- SERWER HTTP I PANEL WWW ---
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'tajnykluczsosession123',
    resave: false,
    saveUninitialized: false
}));

let clientInstance = null;
const verifiedRoles = new Map(); // Przechowuje wybrane role weryfikacji

// Strona główna
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>Bot Weryfikacji</title><style>body{font-family:Arial;background:#313338;color:#fff;text-align:center;padding-top:100px;}a{background:#5865F2;color:#fff;padding:12px 24px;text-decoration:none;border-radius:5px;font-weight:bold;}</style></head>
            <body>
                <h1>Bot Weryfikacji z Panelem WWW</h1>
                <p>Zarządzaj weryfikacją na swoim serwerze Discord przez przeglądarkę.</p>
                <br><br>
                <a href="/auth/discord">Zaloguj przez Discord</a>
            </body>
        </html>
    `);
});

// Endpoint logowania Discord OAuth2
app.get('/auth/discord', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

// Callback po zalogowaniu
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('Błąd autoryzacji.');

    try {
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
            }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const oauthData = await tokenResponse.json();
        if (!oauthData.access_token) return res.send('Nie udało się pobrać tokenu.');

        // Pobieranie danych użytkownika oraz jego serwerów
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `${oauthData.token_type} ${oauthData.access_token}` },
        });
        const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { authorization: `${oauthData.token_type} ${oauthData.access_token}` },
        });

        req.session.user = await userResponse.json();
        req.session.guilds = await guildsResponse.json();

        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.send('Wystąpił błąd podczas logowania.');
    }
});

// Panel sterowania dla użytkownika
app.get('/dashboard', (req, res) => {
    if (!req.session.user || !req.session.guilds) return res.redirect('/');

    // Filtrujemy tylko te serwery, na których użytkownik jest administratorem (uprawnienie Administrator = 0x8)
    const adminGuilds = req.session.guilds.filter(g => (g.permissions & 0x8) === 0x8);

    let guildsHtml = adminGuilds.map(g => `
        <div style="background:#2b2d31; padding:15px; margin:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
            <span><b>${g.name}</b></span>
            <a href="/dashboard/configure/${g.id}" style="background:#248046; color:#fff; padding:8px 16px; text-decoration:none; border-radius:4px;">Konfiguruj</a>
        </div>
    `).join('');

    res.send(`
        <html>
            <head><title>Panel Sterowania</title><style>body{font-family:Arial;background:#313338;color:#fff;padding:50px;}</style></head>
            <body>
                <h1>Witaj, ${req.session.user.username}!</h1>
                <h3>Wybierz serwer do konfiguracji weryfikacji:</h3>
                <div style="max-width:500px;">${guildsHtml || '<p>Brak serwerów z uprawnieniami Administratora lub bot nie jest na nich obecny.</p>'}</div>
                <br><br><a href="/" style="color:#f23f43; text-decoration:none;">Wyloguj</a>
            </body>
        </html>
    `);
});

// Podstrona konfiguracji konkretnego serwera
app.get('/dashboard/configure/:guildId', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const guildId = req.params.guildId;
    const guild = clientInstance ? clientInstance.guilds.cache.get(guildId) : null;

    if (!guild) {
        return res.send('Bot nie znajduje się na tym serwerze lub nie został jeszcze w pełni uruchomiony! <a href="/dashboard">Wróć</a>');
    }

    // Pobieramy role z serwera
    const roles = guild.roles.cache.filter(r => r.name !== '@everyone').map(r => `<option value="${r.id}">${r.name}</option>`).join('');

    res.send(`
        <html>
            <head><title>Konfiguracja serwera</title><style>body{font-family:Arial;background:#313338;color:#fff;padding:50px;}select,input{padding:10px;margin:10px 0;width:300px;display:block;background:#1e1f22;color:#fff;border:1px solid #4e5058;border-radius:4px;}button{background:#5865F2;color:#fff;padding:10px 20px;border:none;border-radius:4px;cursor:pointer;}</style></head>
            <body>
                <h1>Konfiguracja serwera: ${guild.name}</h1>
                <form method="POST" action="/dashboard/save/${guildId}">
                    <label>Wybierz rolę po weryfikacji:</label>
                    <select name="roleId">${roles}</select>
                    <label>ID kanału, na którym wysłać panel weryfikacji:</label>
                    <input type="text" name="channelId" placeholder="Wklej ID kanału textowego" required>
                    <button type="submit">Zapisz i wyślij panel</button>
                </form>
                <br><a href="/dashboard" style="color:#949ba4;">← Wróć do listy serwerów</a>
            </body>
        </html>
    `);
});

// Zapisywanie konfiguracji z panelu WWW
app.post('/dashboard/save/:guildId', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const guildId = req.params.guildId;
    const { roleId, channelId } = req.body;

    const guild = clientInstance.guilds.cache.get(guildId);
    if (!guild) return res.send('Nie znaleziono serwera.');

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.send('Nie znaleziono kanału o podanym ID. <a href="javascript:history.back()">Wróć</a>');

    try {
        // Zapisujemy rolę
        verifiedRoles.set(guildId, roleId);

        // Tworzymy przycisk weryfikacji
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_button')
                .setLabel('Zweryfikuj się')
                .setStyle(ButtonStyle.Success)
        );

        // Wysyłamy panel na wybrany kanał
        await channel.send({
            content: '**Weryfikacja serwera**\nKliknij poniższy przycisk, aby odblokować dostęp do całego serwera:',
            components: [row]
        });

        res.send('<h2>Konfiguracja zapisana pomyślnie, a panel został wysłany na kanał!</h2><a href="/dashboard">Wróć do panelu</a>');
    } catch (err) {
        console.error(err);
        res.send('Wystąpił błąd podczas wysyłania panelu. Upewnij się, że bot ma uprawnienia do pisania na tym kanale.');
    }
});

// Strona statystyk (idealna do UptimeRobot)
app.get('/stats', (req, res) => {
    if (!clientInstance || !clientInstance.isReady()) return res.send('Bot się uruchamia...');
    res.send(`Serwery: ${clientInstance.guilds.cache.size}, Użytkownicy: ${clientInstance.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)}`);
});

app.listen(PORT, () => console.log(`Serwer HTTP i panel WWW uruchomiony na porcie ${PORT}`));

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

// Automatyczne nadawanie roli "Niezweryfikowany" po wejściu na serwer
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

// Obsługa przycisku weryfikacji
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'verify_button') {
        const guildId = interaction.guild.id;
        const verifiedRoleId = verifiedRoles.get(guildId);

        if (!verifiedRoleId) {
            return interaction.reply({ content: 'Weryfikacja nie została skonfigurowana dla tego serwera w panelu WWW.', ephemeral: true });
        }

        const verifiedRole = interaction.guild.roles.cache.get(verifiedRoleId);
        const unverifiedRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');

        if (!verifiedRole) {
            return interaction.reply({ content: 'Nie znaleziono docelowej roli weryfikacji.', ephemeral: true });
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
