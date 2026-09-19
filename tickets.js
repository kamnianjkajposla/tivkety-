const { ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');

function setupTicketsRouter(app, getServerConfig, saveServerConfig, getClient) {
    
    app.post('/configure-ticket', async (req, res) => {
        if (!req.session || !req.session.loggedIn) return res.redirect('/');
        
        try {
            const { guildId, ticketChannelId, ticketTitle, ticketMessage, moduleId } = req.body;
            let supportRoles = req.body.supportRoles || [];
            if (!Array.isArray(supportRoles)) supportRoles = [supportRoles];

            const client = typeof getClient === 'function' ? getClient() : getClient;
            if (!client) return res.status(500).send('Bot nie jest gotowy. <a href="/dashboard">Wróć</a>');

            const guild = client.guilds.cache.get(guildId);
            if (!guild) return res.send('Nie znaleziono bota na serwerze. <a href="/dashboard">Wróć</a>');

            const channel = guild.channels.cache.get(ticketChannelId);
            if (!channel) return res.send('Nie znaleziono kanału. <a href="/dashboard">Wróć</a>');

            let rawNames = req.body['catName[]'] || req.body.catName || [];
            let rawQuestions = req.body['catQuestion[]'] || req.body.catQuestion || [];

            if (!Array.isArray(rawNames)) rawNames = [rawNames];
            if (!Array.isArray(rawQuestions)) rawQuestions = [rawQuestions];

            const categories = [];
            for (let i = 0; i < rawNames.length; i++) {
                const name = String(rawNames[i] || '').trim();
                const question = String(rawQuestions[i] || 'Opisz swój problem:').trim();
                if (name.length > 0) categories.push({ name, question });
            }

            if (categories.length === 0) {
                categories.push({ name: 'Pomoc', question: 'Opisz swój problem:' });
            }

            const currentModuleId = moduleId || 'mod_' + Date.now();
            const config = await getServerConfig(guildId);
            
            // Obsługa wielu modułów w bazie (tablica modułów ticketów)
            let ticketModules = config.ticketModules || [];
            if (!Array.isArray(ticketModules)) ticketModules = [];

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`ticket_select_${currentModuleId}`)
                .setPlaceholder('Wybierz kategorię zgłoszenia...')
                .addOptions(
                    categories.map((cat, idx) => ({
                        label: cat.name.substring(0, 25),
                        value: `cat_${idx}`,
                        description: `Otwórz zgłoszenie: ${cat.name}`.substring(0, 50)
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            const contentText = `${ticketTitle || '**System Zgłoszeń**'}\n${ticketMessage || 'Wybierz kategorię zgłoszenia z menu poniżej:'}`;

            const existingModuleIndex = ticketModules.findIndex(m => m.id === currentModuleId);
            let msgSentId = existingModuleIndex !== -1 ? ticketModules[existingModuleIndex].messageId : null;
            let msgEdited = false;

            if (msgSentId) {
                try {
                    const oldMsg = await channel.messages.fetch(msgSentId);
                    if (oldMsg) {
                        await oldMsg.edit({ content: contentText, components: [row] });
                        msgEdited = true;
                    }
                } catch (e) {
                    // Wiadomość mogła zostać usunięta
                }
            }

            if (!msgEdited) {
                const newMsg = await channel.send({ content: contentText, components: [row] });
                msgSentId = newMsg.id;
            }

            const moduleData = {
                id: currentModuleId,
                channelId: ticketChannelId,
                supportRoles: supportRoles,
                title: ticketTitle || '**System Zgłoszeń**',
                message: ticketMessage || 'Wybierz kategorię:',
                categories: categories,
                messageId: msgSentId
            };

            if (existingModuleIndex !== -1) {
                ticketModules[existingModuleIndex] = moduleData;
            } else {
                ticketModules.push(moduleData);
            }

            await saveServerConfig(guildId, { ticketModules });

            res.send(`
                <div style="font-family: Arial, sans-serif; background: #313338; color: #fff; text-align: center; padding: 50px;">
                    <h2 style="color: #23a55a;">✅ Moduł ticketów został pomyślnie zapisany/zaktualizowany!</h2>
                    <a href="/dashboard" style="color: #5865F2; font-weight: bold; text-decoration: none;">Wróć do panelu</a>
                </div>
            `);
        } catch (err) {
            console.error('Błąd zapisu modułu ticketów:', err);
            res.status(500).send(`Wystąpił błąd: ${err.message}. <a href="/dashboard">Wróć</a>`);
        }
    });

    // Usunięcie modułu
    app.post('/delete-ticket-module', async (req, res) => {
        if (!req.session || !req.session.loggedIn) return res.redirect('/');
        try {
            const { guildId, moduleId } = req.body;
            const config = await getServerConfig(guildId);
            let ticketModules = config.ticketModules || [];
            
            ticketModules = ticketModules.filter(m => m.id !== moduleId);
            await saveServerConfig(guildId, { ticketModules });

            res.redirect('/dashboard');
        } catch (err) {
            console.error(err);
            res.redirect('/dashboard');
        }
    });
}

async function handleTicketInteraction(interaction, getServerConfig) {
    try {
        const config = await getServerConfig(interaction.guild.id);
        const ticketModules = config.ticketModules || [];

        // Obsługa menu wyboru kategorii dla dowolnego modułu
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_select_')) {
            const moduleId = interaction.customId.replace('ticket_select_', '');
            const currentModule = ticketModules.find(m => m.id === moduleId) || ticketModules[0];
            if (!currentModule) return interaction.reply({ content: 'Nie znaleziono konfiguracji tego panelu.', ephemeral: true });

            const selectedValue = interaction.values[0];
            const catIndex = parseInt(selectedValue.split('_')[1]);
            const categories = currentModule.categories || [];
            const category = categories[catIndex] || { name: 'Ogólne', question: 'Opisz swoją sprawę:' };

            const modal = new ModalBuilder()
                .setCustomId(`ticket_modal_${moduleId}_${catIndex}`)
                .setTitle(`Zgłoszenie: ${category.name}`.substring(0, 45));

            const answerInput = new TextInputBuilder()
                .setCustomId('ticket_user_answer')
                .setLabel(category.question.substring(0, 45))
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(answerInput));
            await interaction.showModal(modal);
        }

        // Obsługa wysłania modalu (tworzenie kanału ticketu)
        if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
            const parts = interaction.customId.split('_');
            const moduleId = parts[2];
            const catIndex = parseInt(parts[3]);

            const currentModule = ticketModules.find(m => m.id === moduleId) || ticketModules[0];
            if (!currentModule) return interaction.reply({ content: 'Błąd konfiguracji modułu.', ephemeral: true });

            const category = currentModule.categories[catIndex] || { name: 'Zgłoszenie' };
            const userAnswer = interaction.fields.getTextInputValue('ticket_user_answer');
            const guild = interaction.guild;
            const user = interaction.user;

            await interaction.deferReply({ ephemeral: true });

            const overwrites = [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: interaction.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
            ];

            const supportRoles = currentModule.supportRoles || [];
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
                content: `Witaj ${user}!\n**Moduł:** ${currentModule.title}\n**Kategoria:** ${category.name}\n**Opis:**\n> ${userAnswer}\n\n*Obsługa:* ${supportMentions || 'Brak ról'}`,
                components: [actionRow]
            });

            await interaction.editReply({ content: `Utworzono Twój ticket: ${ticketChannel}!` });
        }

        // Przyciski obsługi ticketu (Przejmij / Zamknij)
        if (interaction.isButton()) {
            if (interaction.customId === 'claim_ticket') {
                // Sprawdzenie czy użytkownik ma uprawnienia z któregokolwiek modułu
                let isSupport = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
                if (!isSupport) {
                    for (const mod of ticketModules) {
                        if (mod.supportRoles && mod.supportRoles.some(rId => interaction.member.roles.cache.has(rId))) {
                            isSupport = true;
                            break;
                        }
                    }
                }

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
        console.error('Błąd interakcji ticketu:', err);
    }
}

module.exports = { setupTicketsRouter, handleTicketInteraction };
