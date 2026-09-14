const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const express = require('express');
const session = require('express-session');

// --- SERWER HTTP I PANEL WWW ---
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'tajnykluczsosession123',
    resave: false,
    saveUninitialized: false
}));

// Baza danych kont z domyślnym kontem na start
const usersDB = new Map();
usersDB.set('sigam11k@wp.pl', 'kicimici');

// Lista przechowująca historię logowań (kto i kiedy się logował)
const loginHistory = [];

let clientInstance = null;
const verifiedRoles = new Map();

// STRONA LOGOWANIA (CZYSTA, BEZ STATYSTYK)
app.get('/', (req, res) => {
    if (req.session.loggedIn) {
        return res.redirect('/dashboard');
    }

    res.send(`
        <html>
            <head>
                <title>Logowanie - Tivkety</title>
                <style>
                    body { font-family: Arial, sans-serif; background-color: #313338; color: #fff; text-align: center; padding-top: 50px; }
                    .card { background-color: #2b2d31; display: inline-block; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); width: 350px; text-align: left; }
                    h1 { color: #5865F2; text-align: center; font-size: 22px; }
                    label { display: block; margin-top: 15px; color: #dbdee1; }
                    input { width: 100%; padding: 10px; margin-top: 5px; background: #1e1f22; color: #fff; border: 1px solid #4e5058; border-radius: 4px; box-sizing: border-box; }
                    button { width: 100%; background: #5865F2; color: #fff; padding: 12px; border: none; border-radius: 4px; cursor: pointer; margin-top: 20px; font-weight: bold; }
                    button:hover { background: #4752c4; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>Logowanie do Panelu</h1>
                    <form method="POST" action="/login">
                        <label>Email:</label>
                        <input type="text" name="email" required>
                        
                        <label>Hasło:</label>
                        <input type="password" name="password" required>
                        
                        <button type="submit">Zaloguj się</button>
                    </form>
                </div>
            </body>
        </html>
    `);
});

// Obsługa logowania + zapis do historii logowań
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (usersDB.has(email) && usersDB.get(email) === password) {
        req.session.loggedIn = true;
        req.session.email = email;

        // Dodajemy wpis do historii logowań z aktualną datą
        loginHistory.unshift({
            email: email,
            time: new Date().toLocaleString('pl-PL')
        });

        res.redirect('/dashboard');
    } else {
        res.send(`<script>alert('Błędny email lub hasło!'); window.location='/';</script>`);
    }
});

// Dodawanie nowego konta przez administratora
app.post('/add-user', (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');
    const { newEmail, newPassword } = req.body;

    if (!newEmail || !newPassword) {
        return res.send(`<script>alert('Wypełnij oba pola!'); window.location='/dashboard';</script>`);
    }

    if (usersDB.has(newEmail)) {
        res.send(`<script>alert('Taki użytkownik już istnieje!'); window.location='/dashboard';</script>`);
    } else {
        usersDB.set(newEmail, newPassword);
        res.send(`<script>alert('Nowe konto zostało pomyślnie utworzone!'); window.location='/dashboard';</script>`);
    }
});

// Wylogowanie
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// PANEL STEROWANIA (ZE STATYSTYKAMI I HISTORIĄ LOGOWAŃ)
app.get('/dashboard', (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');

    if (!clientInstance || !clientInstance.isReady()) {
        return res.send('<h1>Bot się uruchamia... Odśwież stronę za chwilę.</h1>');
    }

    const guilds = clientInstance.guilds.cache.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    const totalServers = clientInstance.guilds.cache.size;
    const totalUsers = clientInstance.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);

    // Generujemy listę historii logowań w HTML
    const historyHtml = loginHistory.map(item => `<li style="margin-bottom: 5px;"><b>${item.email}</b> <span style="color: #949ba4; font-size: 11px;">(${item.time})</span></li>`).join('');

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
                    <!-- Kafel 1: Konfiguracja i Tworzenie Kont -->
                    <div class="card">
                        <h1>Panel Tivkety</h1>
                        <p style="font-size: 13px; color: #949ba4; text-align: center;">Zalogowany jako: <b>${req.session.email}</b></p>
                        
                        <h3>Konfiguracja weryfikacji</h3>
                        <form method="POST" action="/configure">
                            <label>Wybierz serwer:</label>
                            <select name="guildId">${guilds}</select>
                            
                            <label>ID kanału weryfikacji:</label>
                            <input type="text" name="channelId" required>
                            
                            <label>ID roli po weryfikacji:</label>
                            <input type="text" name="roleId" required>
                            
                            <button type="submit">Wyślij panel weryfikacji</button>
                        </form>

                        <h3 style="margin-top: 25px;">Dodaj nowe konto</h3>
                        <form method="POST" action="/add-user">
                            <label>Nowy Email:</label>
                            <input type="text" name="newEmail" required>
                            
                            <label>Nowe Hasło:</label>
                            <input type="password" name="newPassword" required>
                            
                            <button type="submit" style="background: #248046;">Utwórz konto</button>
                        </form>

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

// Statystyki w formacie tekstowym dla UptimeRobot
app.get('/stats', (req, res) => {
    if (!clientInstance || !clientInstance.isReady()) return res.send('Bot się uruchamia...');
    res.send(`Serwery: ${clientInstance.guilds.cache.size}, Użytkownicy: ${clientInstance.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)}`);
});

app.listen(PORT, () => console.log(`Serwer HTTP uruchomiony na porcie ${PORT}`));

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
        const verifiedRoleId = verifiedRoles.get(guildId);

        if (!verifiedRoleId) {
            return interaction.reply({ content: 'Weryfikacja nie została skonfigurowana dla tego serwera.', ephemeral: true });
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
