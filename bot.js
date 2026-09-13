const http = require('http');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');

// 1. Serwer HTTP dla Rendera (utrzymuje darmowy Web Service)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot Discorda z panelem sterowania dziala poprawnie!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serwer HTTP nasłuchuje na porcie ${PORT}`);
});

// 2. Konfiguracja bota Discorda
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('clientReady', () => {
  console.log(`Zalogowano jako ${client.user.tag}! Bot gotowy do pracy.`);
});

// 3. Główna komenda do wywołania Panelu Sterowania (!panel)
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (message.content === '!panel') {
    // Sprawdzenie uprawnień administratora
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('Tylko administrator może otworzyć panel sterowania botem!');
    }

    const panelEmbed = new EmbedBuilder()
      .setTitle('🛠️ Panel Sterowania Botem Sklepu')
      .setDescription('Witaj w centrum dowodzenia! Wybierz odpowiednią akcję z poniższych przycisków, aby zarządzać botem i sklepem na serwerze.')
      .setColor('#3b82f6')
      .addFields(
        { name: '📌 Status', value: '🟢 System online i gotowy', inline: true },
        { name: '👤 Administrator', value: `${message.author.username}`, inline: true }
      )
      .setFooter({ text: 'Sklep Bot - Panel Administracyjny' });

    // Przyciski panelu sterowania
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('send_ticket_panel')
          .setLabel('🛒 Wyślij Panel Ticketów')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('bot_status')
          .setLabel('📊 Status Bota')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('clear_chat')
          .setLabel('🧹 Wyczyść Czat (10)')
          .setStyle(ButtonStyle.Secondary)
      );

    await message.channel.send({ embeds: [panelEmbed], components: [row] });
    await message.delete(); // Usuwa wiadomość z komendą !panel
  }
});

// 4. Obsługa interakcji (przyciski paneli i ticketów)
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  // A. Kliknięcie "Wyślij Panel Ticketów" z poziomu Panelu Sterowania
  if (interaction.customId === 'send_ticket_panel') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Nie masz uprawnień do tej akcji!', ephemeral: true });
    }

    const ticketEmbed = new EmbedBuilder()
      .setTitle('🛒 Sklep & Pomoc - System Ticketów')
      .setDescription('Chcesz kupić rangę VIP lub masz problem? Kliknij przycisk poniżej, aby otworzyć prywatny kanał zgłoszenia z administracją!')
      .setColor('#38bdf8')
      .setFooter({ text: 'Sklep Bot - System Ticketów' });

    const ticketRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('create_ticket')
          .setLabel('🎫 Utwórz Ticket')
          .setStyle(ButtonStyle.Primary)
      );

    await interaction.channel.send({ embeds: [ticketEmbed], components: [ticketRow] });
    await interaction.reply({ content: 'Pomyślnie wysłano panel ticketów na ten kanał!', ephemeral: true });
  }

  // B. Kliknięcie "Status Bota"
  if (interaction.customId === 'bot_status') {
    const uptimeSec = Math.floor(client.uptime / 1000);
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);

    await interaction.reply({ 
      content: `📊 **Statystyki Bota:**\n- **Ping:** ${client.ws.ping}ms\n- **Czas działania (Uptime):** ${hours}h ${minutes}m\n- **Serwery:** ${client.guilds.cache.size}`, 
      ephemeral: true 
    });
  }

  // C. Kliknięcie "Wyczyść Czat"
  if (interaction.customId === 'clear_chat') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: 'Potrzebujesz uprawnienia do zarządzania wiadomościami!', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const messages = await interaction.channel.messages.fetch({ limit: 10 });
      await interaction.channel.bulkDelete(messages, true);
      await interaction.editReply({ content: 'Pomyślnie wyczyszczono ostatnie wiadomości!' });
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: 'Wystąpił błąd podczas czyszczenia wiadomości (wiadomości starsze niż 14 dni nie mogą być masowo usuwane).' });
    }
  }

  // D. Tworzenie indywidualnego ticketu
  if (interaction.customId === 'create_ticket') {
    const guild = interaction.guild;
    const user = interaction.user;

    const existingChannel = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase()}`);
    if (existingChannel) {
      return interaction.reply({ content: `Masz już otwarty ticket: ${existingChannel}`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const ticketChannel = await guild.channels.create({
        name: `ticket-${user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
        ],
      });

      const welcomeEmbed = new EmbedBuilder()
        .setTitle(`Ticket użytkownika ${user.username}`)
        .setDescription('Witaj! Opisz w czym możemy Ci pomóc (np. chęć zakupu rangi VIP). Administracja wkrótce się z Tobą skontaktuje.')
        .setColor('#4ade80');

      const closeRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('🔒 Zamknij Ticket')
            .setStyle(ButtonStyle.Danger)
        );

      await ticketChannel.send({ content: `<@${user.id}>`, embeds: [welcomeEmbed], components: [closeRow] });
      await interaction.editReply({ content: `Utworzono Twój prywatny ticket: ${ticketChannel}` });

    } catch (error) {
      console.error('Błąd tworzenia kanału:', error);
      await interaction.editReply({ content: 'Wystąpił błąd podczas tworzenia ticketu. Upewnij się, że bot ma uprawnienia Administratora.' });
    }
  }

  // E. Zamykanie ticketu
  if (interaction.customId === 'close_ticket') {
    await interaction.reply({ content: 'Zamykanie ticketu za 3 sekundy...' });
    setTimeout(async () => {
      try {
        await interaction.channel.delete();
      } catch (err) {
        console.error('Nie udało się usunąć kanału:', err);
      }
    }, 3000);
  }
});

// 5. Logowanie bota
client.login(process.env.DISCORD_TOKEN);
