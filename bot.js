const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } = require('discord.js');
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
        GatewayIntentBits.GuildMembers
    ]
});

// Tutaj przechowujemy ID roli po weryfikacji dla każdego serwera (w pamięci bota)
const verifiedRoles = new Map();

client.once('ready', async () => {
    console.log(`Zalogowano jako ${client.user.tag}!`);

    // Rejestracja komendy ukośnika (slash command)
    const commands = [
        new SlashCommandBuilder()
            .setName('ustaw_weryfikacje')
            .setDescription('Wysyła panel weryfikacji i ustawia rolę nagrody.')
            .addRoleOption(option => 
                option.setName('rola')
                      .setDescription('Rola, którą użytkownik otrzyma po weryfikacji')
                      .setRequired(true)
            )
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Zarejestrowano komendę /ustaw_weryfikacje.');
    } catch (error) {
        console.error(error);
    }
});

// Automatyczne nadawanie roli "niezweryfikowany" po wejściu na serwer
client.on('guildMemberAdd', async member => {
    try {
        // Szuka roli o nazwie "niezweryfikowany" na serwerie
        let unverifiedRole = member.guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');
        
        // Jeśli rola nie istnieje, bot może ją spróbować stworzyć automatycznie
        if (!unverifiedRole) {
            unverifiedRole = await member.guild.roles.create({
                name: 'Niezweryfikowany',
                color: '#808080',
                permissions: []
            });
        }
        
        await member.roles.add(unverifiedRole);
    } catch (error) {
        console.error('Błąd podczas nadawania roli niezweryfikowany:', error);
    }
});

// Obsługa komendy konfiguracyjnej oraz kliknięcia przycisku
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'ustaw_weryfikacje') {
            // Sprawdzamy czy użytkownik ma uprawnienia administratora
            if (!interaction.member.permissions.has('Administrator')) {
                return interaction.reply({ content: 'Nie masz uprawnień Administratora do tej komendy!', ephemeral: true });
            }

            const targetRole = interaction.options.getRole('rola');
            
            // Zapisujemy wybraną rolę w pamięci dla tego serwera
            verifiedRoles.set(interaction.guild.id, targetRole.id);

            // Tworzymy przycisk weryfikacji
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_button')
                    .setLabel('Zweryfikuj się')
                    .setStyle(ButtonStyle.Success)
            );

            await interaction.reply({ 
                content: `Panel weryfikacyjny skonfigurowany! Pomyślna weryfikacja nada rolę: **${targetRole.name}**`, 
                ephemeral: true 
            });

            // Wysyłamy wiadomość z przyciskiem na kanał, gdzie wpisano komendę
            await interaction.channel.send({
                content: 'Kliknij poniższy przycisk, aby uzyskać pełny dostęp do serwera:',
                components: [row]
            });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'verify_button') {
            const guildId = interaction.guild.id;
            const verifiedRoleId = verifiedRoles.get(guildId);

            if (!verifiedRoleId) {
                return interaction.reply({ content: 'Administrator nie skonfigurował jeszcze roli dla weryfikacji za pomocą komendy /ustaw_weryfikacje.', ephemeral: true });
            }

            const verifiedRole = interaction.guild.roles.cache.get(verifiedRoleId);
            const unverifiedRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'niezweryfikowany');

            if (!verifiedRole) {
                return interaction.reply({ content: 'Nie znaleziono docelowej roli na serwerze.', ephemeral: true });
            }

            try {
                // Dodaje rolę po weryfikacji
                await interaction.member.roles.add(verifiedRole);
                
                // Zabiera rolę niezweryfikowanego (jeśli użytkownik ją ma)
                if (unverifiedRole && interaction.member.roles.cache.has(unverifiedRole.id)) {
                    await interaction.member.roles.remove(unverifiedRole);
                }

                await interaction.reply({ content: 'Pomyślnie zweryfikowano!', ephemeral: true });
            } catch (error) {
                console.error(error);
                await interaction.reply({ content: 'Wystąpił błąd. Upewnij się, że rola bota jest wyżej w hierarchii niż nadawane role!', ephemeral: true });
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
