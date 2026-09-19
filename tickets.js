const { ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');

function setupTicketsRouter(app, getServerConfig, saveServerConfig, clientInstance) {
    
    // Obsługa zapisu konfiguracji ticketów z panelu WWW
    app.post('/configure-ticket', async (req, res) => {
        if (!req.session.loggedIn) return res.redirect('/');
        const { guildId, ticketChannelId, ticketTitle, ticketMessage } = req.body;
        let supportRoles = req.body.supportRoles || [];
        if (!Array.isArray(supportRoles)) supportRoles = [supportRoles];

        const guild = clientInstance.guilds.cache.get(guildId);
        if (!guild) return res.send('Nie znaleziono bota na serwerze. <a href="/dashboard">Wróć</a>');

        const channel = guild.channels.cache.get(ticketChannelId);
        if (!channel) return res.send('Nie znaleziono kanału ticketów. <a href="/dashboard">Wróć</a>');

        // Bezpieczne wyciąganie tablic kategorii (obsługa pojedynczych lub wielu elementów)
        let names = req.body['catName[]'];
        let questions = req.body['catQuestion[]'];

        if (!names) names = [];
        if (!Array.isArray(names)) names = [names];

        if (!questions) questions = [];
        if (!Array.isArray(questions)) questions = [questions];

        const categories = [];
        for (let i = 0; i < names.length; i++) {
            if (names[i] && names[i].trim() !== '') {
                categories.push({
                    name: names[i].trim(),
                    question: (questions[i] || 'Opisz swój problem:').trim()
                });
            }
        }

        if (categories.length === 0) {
            categories.push({ name: 'Pomoc', question: 'Opisz swój problem:' });
        }

        try {
            const config = await getServerConfig(guildId);

            // Usunięcie starego panelu jeśli istnieje
            if (config.ticketMessageId) {
                try {
                    const oldMsg = await channel.messages.fetch(config.ticketMessageId);
                    if (oldMsg) await oldMsg.delete();
                } catch (e) {}
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('ticket_select_category')
                .setPlaceholder('Wybierz kategorię zgłoszenia...')
                .addOptions(
                    categories.map((cat, idx) => ({
                        label: cat.name.substring(0, 25),
                        value: `cat_${idx}`,
                        description: `Otwórz zgłoszenie w kategorii: ${cat.name}`.substring(0, 50)
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            const msgSent = await channel.send({ content: `${ticketTitle}\n${ticketMessage}`, components: [row] });

            await saveServerConfig(guildId, { 
                ticketChannel: ticketChannelId, 
                supportRoles: supportRoles, 
                ticketTitle, 
                ticketMessage,
                ticketCategories: categories,
                ticketMessageId: msgSent.id
            });

            res.send('<h2>Panel ticketów zaktualizowany pomyślnie!</h2><a href="/dashboard">Wróć do panelu</a>');
        } catch (err) {
            console.error('Błąd zapisu ticketów:', err);
            res.send('Wystąpił błąd podczas zapisywania. <a href="/dashboard">Wróć</a>');
        }
    });
}

// Obsługa interakcji Discorda dla ticketów
async function handleTicketInteraction(interaction, getServerConfig) {
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select_category') {
        const selectedValue = interaction.values[0];
        const catIndex = parseInt(selectedValue.split('_')[1]);

        const config = await getServerConfig(interaction.guild.id);
        const categories = config.ticketCategories || [];
        const category = categories[catIndex] || { name: 'Ogólne', question: 'Opisz swoją sprawę:' };

        const modal = new ModalBuilder()
            .setCustomId(`ticket_modal_${catIndex}`)
            .setTitle(`Zgłoszenie: ${category.name}`.substring(0, 45));

        const answerInput = new TextInputBuilder()
            .setCustomId('ticket_user_answer')
            .setLabel(category.question.substring(0, 45))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(answerInput));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
        const catIndex = parseInt(interaction.customId.split('_')[2]);
        const config = await getServerConfig(interaction.guild.id);
        const categories = config.ticketCategories || [];
        const category = categories[catIndex] || { name: 'Zgłoszenie' };
        
        const userAnswer = interaction.fields.getTextInputValue('ticket_user_answer');
        const guild = interaction.guild;
        const user = interaction.user;

        await interaction.deferReply({ ephemeral: true });

        try {
            const overwrites = [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: interaction.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
            ];

            const supportRoles = config.supportRoles || [];
            supportRoles.forEach(roleId => {
                overwrites.push({
                    id: roleId,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
                });
            });

            const ticketChannel = await guild.channels.create({
                name: `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, ''),
                type: ChannelType.GuildText,
                permissionOverwrites: overwrites,
            });

            const supportMentions = supportRoles.map(rId => `<@&${rId}>`).join(' ');

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('Przejmij ticket 🙋‍♂️').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Zamknij ticket 🔒').setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: `Witaj ${user}!\n**Role obsługi:** ${supportMentions || 'Brak'}\n**Kategoria:** ${category.name}\n**Odpowiedź na pytanie:**\n> ${userAnswer}\n\n*Administracja wkrótce odpowie.*`,
                components: [actionRow]
            });

            await interaction.editReply({ content: `Utworzono Twój ticket: ${ticketChannel}!` });
        } catch (err) {
            console.error('Błąd tworzenia kanału ticketu:', err);
            await interaction.editReply({ content: 'Wystąpił błąd podczas tworzenia kanału ticketu.' });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'claim_ticket') {
            const config = await getServerConfig(interaction.guild.id);
            const supportRoles = config.supportRoles || [];
            const hasRole = supportRoles.some(roleId => interaction.member.roles.cache.has(roleId));
            const isSupport = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) || hasRole;

            if (!isSupport) {
                return interaction.reply({ content: 'Nie masz uprawnień do przejęcia tego ticketu!', ephemeral: true });
            }

            await interaction.reply({ content: `🙋‍♂️ Ten ticket został przejęty przez **${interaction.user.tag}**.` });
        }

        if (interaction.customId === 'close_ticket') {
            await interaction.reply({ content: 'Zamykanie ticketu za 3 sekundy...' });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
        }
    }
}

module.exports = { setupTicketsRouter, handleTicketInteraction };
