const { ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');

function setupTicketsRouter(app, getServerConfig, saveServerConfig, getClient) {
    
    app.post('/configure-ticket', async (req, res) => {
        if (!req.session || !req.session.loggedIn) return res.redirect('/');
        
        try {
            const { guildId, ticketChannelId, ticketTitle, ticketMessage, ticketImage, moduleId } = req.body;
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

                if (name.length > 0 || question.length > 0) {
                    if (!categoriesMap[cIndex]) {
                        categoriesMap[cIndex] = { name: name || 'Kategoria', questions: [] };
                    }
                    if (name.length > 0) {
                        categoriesMap[cIndex].name = name;
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
                        label: (cat.name || 'Pomoc').substring(0, 25),
                        value: `cat_${idx}`,
                        description: `Otwórz zgłoszenie: ${cat.name || 'Pomoc'}`.substring(0, 50)
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            const contentText = `${ticketTitle || '**System Zgłoszeń**'}\n${ticketMessage || 'Wybierz kategorię zgłoszenia z menu poniżej:'}`;
            
            // Obsługa obrazka w wiadomości
            const messagePayload = {
                content: contentText,
                components: [row]
            };
            if (ticketImage && ticketImage.trim().length > 0) {
                messagePayload.files = [ticketImage.trim()];
            }

            const existingModuleIndex = ticketModules.findIndex(m => m.id === currentModuleId);
            let msgSentId = existingModuleIndex !== -1 ? ticketModules[existingModuleIndex].messageId : null;
            let msgEdited = false;

            if (msgSentId) {
                try {
                    const oldMsg = await channel.messages.fetch(msgSentId);
                    if (oldMsg) {
                        await oldMsg.edit(messagePayload);
                        msgEdited = true;
                    }
                } catch (e) {}
            }

            if (!msgEdited) {
                const newMsg = await channel.send(messagePayload);
                msgSentId = newMsg.id;
            }

            const moduleData = {
                id: currentModuleId,
                channelId: ticketChannelId,
                supportRoles: supportRoles,
                title: ticketTitle || '**System Zgłoszeń**',
                message: ticketMessage || 'Wybierz kategorię:',
                image: ticketImage || '',
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
                    <h2 style="color: #23a55a;">✅ Panel ticketów został pomyślnie zapisany i zaktualizowany!</h2>
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

async function handleTicketInteraction(interaction, getServerConfig, saveServerConfig) {
    try {
        const config = await getServerConfig(interaction.guild.id);
        const ticketModules = config.ticketModules || [];

        // Obsługa Komend Ukośnika (Slash Commands)
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'ticket') {
                const subCommand = interaction.options.getSubcommand();
                if (subCommand === 'panel') {
                    const panelId = interaction.options.getString('panel');
                    const targetModule = ticketModules.find(m => m.id === panelId) || ticketModules[0];
                    if (!targetModule) return interaction.reply({ content: '❌ Nie znaleziono żadnego aktywnego panelu ticketów.', ephemeral: true });

                    const categories = Array.isArray(targetModule.categories) ? targetModule.categories : [{ name: 'Pomoc', questions: ['Opisz swój problem:'] }];

                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`ticket_select_${targetModule.id}`)
                        .setPlaceholder('Wybierz kategorię zgłoszenia...')
                        .addOptions(
                            categories.map((cat, idx) => ({
                                label: (cat.name || 'Ogólne').substring(0, 25),
                                value: `cat_${idx}`,
                                description: `Otwórz zgłoszenie: ${cat.name || 'Ogólne'}`.substring(0, 50)
                            }))
                        );

                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    const payload = {
                        content: `${targetModule.title || '**System Zgłoszeń**'}\n${targetModule.message || 'Wybierz kategorię:'}`,
                        components: [row]
                    };
                    if (targetModule.image && targetModule.image.trim().length > 0) {
                        payload.files = [targetModule.image.trim()];
                    }

                    await interaction.channel.send(payload);
                    return await interaction.reply({ content: '✅ Pomyślnie wysłano panel ticketów na ten kanał!', ephemeral: true });
                }
            }

            if (interaction.commandName === 'weryfikacja') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: '❌ Wymagane uprawnienie Administratora!', ephemeral: true });
                }

                const channel = interaction.options.getChannel('kanal');
                const targetChannel = interaction.options.getChannel('kanal_po_weryfikacji');

                config.verification = {
                    channelId: channel.id,
                    targetChannelId: targetChannel ? targetChannel.id : null
                };
                await saveServerConfig(interaction.guild.id, config);

                const verifyButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('do_verification').setLabel('Zweryfikuj się ✅').setStyle(ButtonStyle.Success)
                );

                await channel.send({
                    content: '**Weryfikacja Serwera**\nKliknij przycisk poniżej, aby uzyskać pełny dostęp do serwera!',
                    components: [verifyButton]
                });

                return await interaction.reply({ content: `✅ Pomyślnie skonfigurowano weryfikację na kanale ${channel}!`, ephemeral: true });
            }
        }

        if (interaction.isAutocomplete()) {
            if (interaction.commandName === 'ticket') {
                const focusedOption = interaction.options.getFocused(true);
                if (focusedOption.name === 'panel') {
                    const choices = ticketModules.map(m => ({ name: (m.title || 'Panel').replace(/\*/g, ''), value: m.id }));
                    const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedOption.value.toLowerCase()));
                    return await interaction.respond(filtered.slice(0, 25));
                }
            }
        }

        // 1. Wybór kategorii z menu ticketów
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_select_')) {
            const moduleId = interaction.customId.replace('ticket_select_', '');
            const currentModule = ticketModules.find(m => m.id === moduleId) || ticketModules[0];
            if (!currentModule) return interaction.reply({ content: '❌ Nie znaleziono konfiguracji panelu.', ephemeral: true });

            const selectedValue = interaction.values[0];
            const catIndex = parseInt(selectedValue.split('_')[1]) || 0;
            
            const categories = Array.isArray(currentModule.categories) && currentModule.categories.length > 0 
                ? currentModule.categories 
                : [{ name: 'Ogólne', questions: ['Opisz swój problem:'] }];
            
            const category = categories[catIndex] || categories[0] || { name: 'Ogólne', questions: ['Opisz swój problem:'] };
            if (!Array.isArray(category.questions) || category.questions.length === 0) {
                category.questions = ['Opisz swój problem:'];
            }

            const modal = new ModalBuilder()
                .setCustomId(`ticket_modal_${moduleId}_${catIndex}_0`)
                .setTitle(`Zgłoszenie: ${category.name || 'Ogólne'}`.substring(0, 45));

            const firstQuestion = category.questions[0] || 'Opisz swój problem:';
            const answerInput = new TextInputBuilder()
                .setCustomId('ticket_q_0')
                .setLabel(firstQuestion.substring(0, 45))
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(answerInput));
            return await interaction.showModal(modal);
        }

        // 2. Obsługa odpowiedzi z modalu (wieloetapowe pytania)
        if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
            const parts = interaction.customId.split('_');
            const moduleId = parts[2];
            const catIndex = parseInt(parts[3]) || 0;
            const questionIndex = parseInt(parts[4]) || 0;

            const currentModule = ticketModules.find(m => m.id === moduleId) || ticketModules[0];
            if (!currentModule) return interaction.reply({ content: '❌ Błąd modułu.', ephemeral: true });

            const categories = Array.isArray(currentModule.categories) ? currentModule.categories : [{ name: 'Ogólne', questions: ['Opisz swój problem:'] }];
            const category = categories[catIndex] || categories[0] || { name: 'Ogólne', questions: ['Opisz swój problem:'] };
            if (!Array.isArray(category.questions) || category.questions.length === 0) {
                category.questions = ['Opisz swój problem:'];
            }

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
                content: `Witaj ${user}!\n**Panel:** ${currentModule.title || 'Zgłoszenie'}\n**Kategoria:** ${category.name || 'Ogólne'}\n\n${formattedAnswers}\n\n*Obsługa:* ${supportMentions || 'Brak ról'}`,
                components: [actionRow]
            });

            return await interaction.editReply({ content: `✅ Utworzono Twój stały ticket: ${ticketChannel}!` });
        }

        // 3. Obsługa przycisków
        if (interaction.isButton()) {
            if (interaction.customId === 'do_verification') {
                let unverifiedRole = interaction.guild.roles.cache.find(r => r.name === 'Niezweryfikowany');
                if (unverifiedRole && interaction.member.roles.cache.has(unverifiedRole.id)) {
                    await interaction.member.roles.remove(unverifiedRole.id);
                }
                return await interaction.reply({ content: '✅ Pomyślnie zweryfikowano! Masz teraz dostęp do serwera.', ephemeral: true });
            }

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
        console.error('Błąd interakcji:', err);
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
