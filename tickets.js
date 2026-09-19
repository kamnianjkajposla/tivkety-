const { ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');

function setupTicketsRouter(app, getServerConfig, saveServerConfig, getClient) {
    
    // Obsługa zapisu konfiguracji ticketów z panelu WWW
    app.post('/configure-ticket', async (req, res) => {
        if (!req.session || !req.session.loggedIn) return res.redirect('/');
        
        try {
            const { guildId, ticketChannelId, ticketTitle, ticketMessage } = req.body;
            let supportRoles = req.body.supportRoles || [];
            if (!Array.isArray(supportRoles)) supportRoles = [supportRoles];

            const client = typeof getClient === 'function' ? getClient() : getClient;
            
            if (!client) {
                return res.status(500).send('Bot nie jest jeszcze gotowy. <a href="/dashboard">Wróć</a>');
            }

            const guild = client.guilds.cache.get(guildId);
            if (!guild) return res.send('Nie znaleziono bota na serwerze. <a href="/dashboard">Wróć</a>');

            const channel = guild.channels.cache.get(ticketChannelId);
            if (!channel) return res.send('Nie znaleziono wybranego kanału ticketów. <a href="/dashboard">Wróć</a>');

            // --- BEZPIECZNE PARSOWANIE KATEGORII (PZapobiega crashom Bad Gateway) ---
            let rawNames = req.body['catName[]'] || req.body.catName || [];
            let rawQuestions = req.body['catQuestion[]'] || req.body.catQuestion || [];

            if (!Array.isArray(rawNames)) rawNames = [rawNames];
            if (!Array.isArray(rawQuestions)) rawQuestions = [rawQuestions];

            const categories = [];
            for (let i = 0; i < rawNames.length; i++) {
                const name = String(rawNames[i] || '').trim();
                const question = String(rawQuestions[i] || 'Opisz swój problem:').trim();

                if (name.length > 0) {
                    categories.push({ name, question });
                }
            }

            // Domyślna kategoria, jeśli użytkownik wszystko usunął
            if (categories.length === 0) {
                categories.push({ name: 'Pomoc', question: 'Opisz swój problem:' });
            }

            const config = await getServerConfig(guildId);

            // Usunięcie starej wiadomości panelu, jeśli istnieje
            if (config.ticketMessageId) {
                try {
                    const oldMsg = await channel.messages.fetch(config.ticketMessageId);
                    if (oldMsg) await oldMsg.delete();
                } catch (e) {
                    // Ignoruj jeśli wiadomość została usunięta ręcznie
                }
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('ticket_select_category')
                .setPlaceholder('Wybierz kategorię zgłoszenia...')
                .addOptions(
                    categories.map((cat, idx) => ({
                        label: cat.name.substring(0, 25),
                        value: `cat_${idx}`,
                        description: `Otwórz zgłoszenie: ${cat.name}`.substring(0, 50)
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            const msgSent = await channel.send({ 
                content: `${ticketTitle || '**System Zgłoszeń**'}\n${ticketMessage || 'Wybierz kategorię zgłoszenia z menu poniżej:'}`, 
                components: [row] 
            });

            await saveServerConfig(guildId, { 
                ticketChannel: ticketChannelId, 
                supportRoles: supportRoles, 
                ticketTitle: ticketTitle || '**System Zgłoszeń**', 
                ticketMessage: ticketMessage || 'Wybierz kategorię:',
                ticketCategories: categories,
                ticketMessageId: msgSent.id
            });

            res.send(`
                <div style="font-family: Arial, sans-serif; background: #313338; color: #fff; text-align: center; padding: 50px;">
                    <h2 style="color: #23a55a;">✅ Panel ticketów został pomyślnie zaktualizowany!</h2>
                    <a href="/dashboard" style="color: #5865F2; font-weight: bold; text-decoration: none;">Wróć do panelu</a>
                </div>
            `);
        } catch (err) {
            console.error('❌ BŁĄD PODCZAS ZAPISU TICKETÓW:', err);
            res.status(500).send(`
                <div style="font-family: Arial, sans-serif; background: #313338; color: #fff; text-align: center; padding: 50px;">
                    <h2 style="color: #f23f43;">❌ Wystąpił błąd podczas zapisywania!</h2>
                    <p style="color: #b5bac1;">${err.message}</p>
                    <a href="/dashboard" style="color: #5865F2; font-weight: bold; text-decoration: none;">Wróć do panelu</a>
                </div>
            `);
        }
    });
}

// Obsługa interakcji na Discordzie
async function handleTicketInteraction(interaction, getServerConfig) {
    try {
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

            const overwrites = [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: interaction.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
            ];

            const supportRoles = config.supportRoles || [];
            supportRoles.forEach(roleId => {
                if (guild.roles.cache.has(roleId)) {
                    overwrites.push({
                        id: roleId,
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
                    });
                }
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
                content: `Witaj ${user}!\n**Kategoria:** ${category.name}\n**Odpowiedź na pytanie:**\n> ${userAnswer}\n\n*Powiadomiono obsługę:* ${supportMentions || 'Brak ról'}`,
                components: [actionRow]
            });

            await interaction.editReply({ content: `Utworzono Twój ticket: ${ticketChannel}!` });
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
    } catch (err) {
        console.error('Błąd podczas obsługi interakcji ticketu:', err);
    }
}

module.exports = { setupTicketsRouter, handleTicketInteraction };
