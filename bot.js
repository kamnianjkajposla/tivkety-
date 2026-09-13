const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const express = require('express');

// --- SERWER HTTP DLA RENDERA (ZE STATYSTYKAMI) ---
const app = express();
const PORT = process.env.PORT || 10000;

// Przechowujemy referencję do klienta bota, żeby serwer HTTP mógł odczytać dane
let clientInstance = null;

// Strona główna
app.get('/', (req, res) => {
    res.send('<h1>Bot weryfikacji dziala poprawnie!</h1><p>Wejdz na <a href="/stats">/stats</a>, aby zobaczyc statystyki bota.</p>');
});

// Strona ze statystykami
app.get('/stats', (req, res) => {
    if (!clientInstance || !clientInstance.isReady()) {
        return res.send('<h1>Bot jest w trakcie uruchamiania... Spróbuj ponownie za chwilę.</h1>');
    }

    const totalServers = clientInstance.guilds.cache.size;
    // Liczymy wszystkich użytkowników na wszystkich serwerach bota
    const totalUsers = clientInstance.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);

    res.send(`
        <html>
            <head>
                <title>Statystyki Bota</title>
                <style>
                    body { font-family: Arial, sans-serif; background-color: #313338; color: #fff; text-align: center; padding-top: 50px; }
                    .card { background-color: #2b2d31; display: inline-block; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
                    h1 { color: #5865F2; }
                    .stat { font-size: 24px; margin: 15px 0; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>Statystyki Bota Weryfikacji</h1>
                    <div class="stat">Serwery: <b>${totalServers}</b></div>
                    <div class="stat">Użytkownicy: <b>${totalUsers}</b></div>
                    <p style="color: #949ba4; margin-top: 20px;">Status: Online 24/7</p>
                </div>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Serwer HTTP uruchomiony na porcie ${PORT}`);
});

// --- BOT DISCORDA ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

clientInstance = client; // Przypisujemy klienta do zmiennej dla serwera HTTP

const verifiedRoles = new Map();

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}!`);
});

// Automatyczne nadawanie roli "Niezweryfikowany" po wejściu na serwer
client.on('guildMemberAdd', async member => {
    try {
        let unverifiedRole = member.guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');
        
        if (!unverifiedRole) {
            unverifiedRole = await member.guild.roles.create({
                name: 'Niezweryfikowany',
                color: '#808080',
                permissions: []
            });
        }
        
        await member.roles.add(unverifiedRole);
    } catch (error) {
        console.error('Błąd podczas nadawania roli Niezweryfikowany:', error);
    }
});

// Obsługa komendy !weryfikacja @RolaDocelowa
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content.startsWith('!weryfikacja')) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('Nie masz uprawnień Administratora do użycia tej komendy!');
        }

        const targetRole = message.mentions.roles.first();
        if (!targetRole) {
            return message.reply('Musisz oznaczyć rolę docelową! Przykład: `!weryfikacja @Zweryfikowany`');
        }

        const guild = message.guild;
        const verificationChannel = message.channel;

        await message.reply('Trwa automatyczna konfiguracja uprawnień na serwerze...');

        try {
            let unverifiedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');
            if (!unverifiedRole) {
                unverifiedRole = await guild.roles.create({
                    name: 'Niezweryfikowany',
                    color: '#808080',
                    permissions: []
                });
            }

            const channels = guild.channels.cache.values();
            for (const channel of channels) {
                if (channel.id === verificationChannel.id) continue;

                try {
                    await channel.permissionOverwrites.edit(unverifiedRole, {
                        ViewChannel: false
                    });
                } catch (err) {
                    console.log(`Nie udało się zmienić uprawnień dla kanału ${channel.name}`);
                }
            }

            await verificationChannel.permissionOverwrites.set([
                {
                    id: guild.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
                    deny: [PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: unverifiedRole.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
                    deny: [PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: client.user.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels],
                }
            ]);

            verifiedRoles.set(guild.id, targetRole.id);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_button')
                    .setLabel('Zweryfikuj się')
                    .setStyle(ButtonStyle.Success)
            );

            await verificationChannel.send({
                content: '**Weryfikacja serwera**\nKliknij poniższy przycisk, aby odblokować dostęp do całego serwera:',
                components: [row]
            });

        } catch (error) {
            console.error(error);
            message.channel.send('Wystąpił błąd podczas blokowania kanałów. Upewnij się, że rola bota jest najwyżej w zakładce Role na serwerze!');
        }
    }
});

// Obsługa kliknięcia przycisku weryfikacji
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'verify_button') {
        const guildId = interaction.guild.id;
        const verifiedRoleId = verifiedRoles.get(guildId);

        if (!verifiedRoleId) {
            return interaction.reply({ content: 'Administrator nie skonfigurował jeszcze roli za pomocą komendy `!weryfikacja`.', ephemeral: true });
        }

        const verifiedRole = interaction.guild.roles.cache.get(verifiedRoleId);
        const unverifiedRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');

        if (!verifiedRole) {
            return interaction.reply({ content: 'Nie znaleziono docelowej roli na serwerze.', ephemeral: true });
        }

        try {
            await interaction.member.roles.add(verifiedRole);
            
            if (unverifiedRole && interaction.member.roles.cache.has(unverifiedRole.id)) {
                await interaction.member.roles.remove(unverifiedRole);
            }

            await interaction.reply({ content: 'Pomyślnie zweryfikowano! Masz teraz dostęp do całego serwera.', ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Wystąpił błąd. Upewnij się, że rola bota jest wyżej w hierarchii niż nadawane role!', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
