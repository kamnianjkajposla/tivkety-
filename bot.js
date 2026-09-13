const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const express = require('express');

// --- CZĘŚĆ 1: Serwer HTTP dla Rendera ---
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Bot Discord dziala poprawnie!');
});

app.listen(PORT, () => {
    console.log(`Serwer HTTP uruchomiony na porcie ${PORT}`);
});

// --- CZĘŚĆ 2: Bot Discorda ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// ID roli, którą ma nadawać przycisk (zmień na ID ze swojego serwera)
const ROLE_ID = "123456789012345678"; 

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}!`);
});

// Obsługa kliknięcia przycisku weryfikacji
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'verify_button') {
        const member = interaction.member;
        const role = interaction.guild.roles.cache.get(ROLE_ID);

        if (!role) {
            return interaction.reply({ content: 'Nie znaleziono roli weryfikacji na serwerze.', ephemeral: true });
        }

        try {
            await member.roles.add(role);
            await interaction.reply({ content: 'Pomyślnie zweryfikowano!', ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Wystąpił błąd podczas nadawania roli. Sprawdź uprawnienia bota.', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
