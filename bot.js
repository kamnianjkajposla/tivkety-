const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const express = require('express');

// --- SERWER HTTP DLA RENDERA ---
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Bot weryfikacji dziala poprawnie!');
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

// Przechowywanie wybranej roli po weryfikacji dla każdego serwera
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
            // 1. Znajdujemy lub tworzymy rolę "Niezweryfikowany"
            let unverifiedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');
            if (!unverifiedRole) {
                unverifiedRole = await guild.roles.create({
                    name: 'Niezweryfikowany',
                    color: '#808080',
                    permissions: []
                });
            }

            // 2. BLOKUJEMY CAŁY SERWER: Przechodzimy przez wszystkie kanały i kategorie
            const channels = guild.channels.cache.values();
            for (const channel of channels) {
                // Pomijamy kanał weryfikacyjny, go skonfigurujemy osobno
                if (channel.id === verificationChannel.id) continue;

                try {
                    await channel.permissionOverwrites.edit(unverifiedRole, {
                        ViewChannel: false // Ukrywa kanał przed niezweryfikowanym
                    });
                } catch (err) {
                    console.log(`Nie udało się zmienić uprawnień dla kanału ${channel.name}`);
                }
            }

            // 3. ODKRYWAMY TYLKO KANAŁ WERYFIKACJI
            await verificationChannel.permissionOverwrites.set([
                {
                    id: guild.id, // @everyone widzi kanał, ale nie pisze
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
                    deny: [PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: unverifiedRole.id, // Rola Niezweryfikowany widzi tylko ten kanał
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
                    deny: [PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: client.user.id, // Bot ma pełny dostęp
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels],
                }
            ]);

            // Zapisujemy wybraną rolę w pamięci
            verifiedRoles.set(guild.id, targetRole.id);

            // Tworzymy przycisk weryfikacji
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_button')
                    .setLabel('Zweryfikuj się')
                    .setStyle(ButtonStyle.Success)
            );

            // Wysyłamy panel z przyciskiem na kanał weryfikacji
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
            // Nadaje rolę zweryfikowaną i zabiera niezweryfikowanego
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
