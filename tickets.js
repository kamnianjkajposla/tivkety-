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

            let rawCatNames = req.body['catName[]'] || req.body.catName || [];
            let rawCatIndices = req.body['catIndex[]'] || req.body.catIndex || [];
            let rawQuestions = req.body['catQuestion[]'] || req.body.catQuestion || [];

            if (!Array.isArray(rawCatNames)) rawCatNames = [rawCatNames];
            if (!Array.isArray(rawCatIndices)) rawCatIndices = [rawCatIndices];
            if (!Array.isArray(rawQuestions)) rawQuestions = [rawQuestions];

            const categoriesMap = {};
            for (let i = 0; i < rawCatNames.length; i++) {
                const name = String(rawCatNames[i] || '').trim();
                const question = String(rawQuestions[i] || '').trim();
                const cIndex = rawCatIndices[i] !== undefined ? String(rawCatIndices[i]) : '0';

                if (name.length > 0) {
                    if (!categoriesMap[cIndex]) {
                        categoriesMap[cIndex] = { name, questions: [] };
                    }
                    if (question.length > 0) {
                        categoriesMap[cIndex].questions.push(question);
                    }
                }
            }

            Object.values(categoriesMap).forEach(cat => {
                if (cat.questions.length === 0) {
                    cat.questions.push('Opisz swój problem:');
                }
            });

            const categories = Object.values(categoriesMap);
            if (categories.length === 0) {
                categories.push({ name: 'Pomoc', questions: ['Opisz swój problem:'] });
            }

            const currentModuleId = moduleId || 'mod_' + Date.now();
            const config = await getServerConfig(guildId);
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
                } catch (e) {}
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
                    <h2 style="color: #23a55a;">✅ Stały panel ticketów został pomyślnie zaktualizowany!</h2>
                    <a href="/dashboard" style="color: #5865F2; font-weight: bold; text-decoration: none;">Wróć do panelu</a>
                </div>
            `);
        } catch (err) {
            console.error('Błąd zapisu modułu:', err);
            res.status(500).send(`Wystąpił błąd: ${err.message}. <a href="/dashboard">Wróć</a>`);
        }
    });

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
            res.redirect('/dashboard');
        }
    });
}

async function handleTicketInteraction(interaction, getServerConfig) {
    try {
        const config = await getServerConfig(interaction.guild.id);
        const ticketModules = config.ticketModules || [];

        // Obsługa Komend Ukośnika (Slash Commands) oraz podpowiedzi (Autocomplete)
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'ticket') {
                const subCommand = interaction.options.getSubcommand();
                if (subCommand === 'panel') {
                    const panelId = interaction.options.getString('panel');
                    const targetModule = ticketModules.find(m => m.id === panelId) || ticketModules[0];
                    if (!targetModule) return interaction.reply({ content: '❌ Nie znaleziono żadnego aktywnego panelu ticketów.', ephemeral: true });

                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`ticket_select_${targetModule.id}`)
                        .setPlaceholder('Wybierz kategorię zgłoszenia...')
                        .addOptions(
                            targetModule.categories.map((cat, idx) => ({
                                label: cat.name.substring(0, 25),
                                value: `cat_${idx}`,
                                description: `Otwórz zgłoszenie: ${cat.name}`.substring(0, 50)
                            }))
                        );

                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    await interaction.channel.send({
                        content: `${targetModule.title}\n${targetModule.message}`,
                        components: [row]
                    });
                    return await interaction.reply({ content: '✅ Pomyślnie wysłano panel ticketów na ten kanał!', ephemeral: true });
                }
            }
        }

        if (interaction.isAutocomplete()) {
            if (interaction.commandName === 'ticket') {
                const focusedOption = interaction.options.getFocused(true);
                if (focusedOption.name === 'panel') {
                    const choices = ticketModules.map(m => ({ name: m.title.replace(/\*/g, ''), value: m.id }));
                    const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedOption.value.toLowerCase()));
                    return await interaction.respond(filtered.slice(0, 25));
                }
            }
        }

        // Wybór kategorii z menu
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_select_')) {
            const moduleId = interaction.customId.replace('ticket_select_', '');
            const currentModule = ticketModules.find(m => m.id === moduleId) || ticketModules[0];
            if (!currentModule) return interaction.reply({ content: '❌ Nie znaleziono konfiguracji panelu.', ephemeral: true });

            const selectedValue = interaction.values[0];
            const catIndex = parseInt(selectedValue.split('_')[1]);
            const categories = currentModule.categories || [];
            const category = categories[catIndex] || { name: 'Ogólne', questions: ['Opisz problem:'] };

            const modal = new ModalBuilder()
                .setCustomId(`ticket_modal_${moduleId}_${catIndex}_0`)
                .setTitle(`Zgłoszenie: ${category.name}`.substring(0, 45));

            const firstQuestion = category.questions[0] || 'Opisz swój problem:';
            const answerInput = new TextInputBuilder()
                .setCustomId('ticket_q_0')
                .setLabel(firstQuestion.substring(0, 45))
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(answerInput));
            return await interaction.showModal(modal);
        }

        // Obsługa odpowiedzi z modalu
        if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
            const parts = interaction.customId.split('_');
            const moduleId = parts[2];
            const catIndex = parseInt(parts[3]);
            const questionIndex = parseInt(parts[4]);

            const currentModule = ticketModules.find(m => m.id === moduleId) || ticketModules[0];
            if (!currentModule) return interaction.reply({ content: '❌ Błąd modułu.', ephemeral: true });

            const category = currentModule.categories[catIndex];
            let userAnswer = '';
            try {
                userAnswer = interaction.fields.getTextInputValue('ticket_q_0');
            } catch (e) {
                userAnswer = 'Brak odpowiedzi';
            }

            if (!interaction.client.tempAnswers) interaction.client.tempAnswers = {};
            const userKey = `${interaction.user.id}_${moduleId}`;
            
            if (!interaction.client.tempAnswers[userKey]) {
                interaction.client.tempAnswers[userKey] = { answers: [] };
            }
            
            interaction.client.tempAnswers[userKey].answers.push({
                question: category.questions[questionIndex] || 'Pytanie',
                answer: userAnswer
            });

            const nextQIndex = questionIndex + 1;
            
            if (nextQIndex < category.questions.length) {
                const modal = new ModalBuilder()
                    .setCustomId(`ticket_modal_${moduleId}_${catIndex}_${nextQIndex}`)
                    .setTitle(`Pytanie ${nextQIndex + 1} / ${category.questions.length}`.substring(0, 45));

                const nextInput = new TextInputBuilder()
                    .setCustomId('ticket_q_0')
                    .setLabel(category.questions[nextQIndex].substring(0, 45))
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(nextInput));
                return await interaction.showModal(modal);
            }

            await interaction.deferReply({ ephemeral: true });

            const guild = interaction.guild;
            const user = interaction.user;
            const allQA = interaction.client.tempAnswers[userKey].answers;
            delete interaction.client.tempAnswers[userKey];

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
            let formattedAnswers = allQA.map(item => `**${item.question}**\n> ${item.answer}`).join('\n\n');

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('Przejmij ticket 🙋‍♂️').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Zamknij ticket 🔒').setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: `Witaj ${user}!\n**Panel:** ${currentModule.title}\n**Kategoria:** ${category.name}\n\n${formattedAnswers}\n\n*Obsługa:* ${supportMentions || 'Brak ról'}`,
                components: [actionRow]
            });

            return await interaction.editReply({ content: `✅ Utworzono Twój stały ticket: ${ticketChannel}!` });
        }

        // Obsługa przycisków w ticketach
        if (interaction.isButton()) {
            if (interaction.customId === 'claim_ticket') {
                let isSupport = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
                if (!isSupport) {
                    for (const mod of ticketModules) {
                        if (mod.supportRoles && mod.supportRoles.some(rId => interaction.member.roles.cache.has(rId))) {
                            isSupport = true;
                            break;
                        }
                    }
                }
                if (!isSupport) return interaction.reply({ content: '❌ Brak uprawnień do przejęcia!', ephemeral: true });
                return await interaction.reply({ content: `🙋‍♂️ Ticket przejęty przez **${interaction.user.tag}**.` });
            }

            if (interaction.customId === 'close_ticket') {
                await interaction.reply({ content: '🔒 Zamykanie ticketu za 3 sekundy...' });
                setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
            }
        }
    } catch (err) {
        console.error('Błąd interakcji ticketu:', err);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: `❌ Wystąpił błąd: ${err.message}` });
            } else {
                await interaction.reply({ content: `❌ Wystąpił błąd: ${err.message}`, ephemeral: true });
            }
        } catch (e) {}
    }
}

module.exports = { setupTicketsRouter, handleTicketInteraction };
