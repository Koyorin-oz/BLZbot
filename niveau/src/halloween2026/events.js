const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { PHRASES, parisParts } = require('./config');
const { generalId, progress } = require('./rewards');
const { isLive } = require('./live');
const { grantEventCurrency } = require('../utils/db-halloween');
const store = require('./store');

/** @type {Map<string, any>} */
const running = new Map();

function quietHour() {
    const h = parisParts().hour;
    return h >= 1 && h < 9;
}

function boardText(cells) {
    const icon = (v) => (v === 'X' ? '❌' : v === 'O' ? '⭕' : '⬜');
    const rows = [];
    for (let r = 0; r < 3; r++) {
        rows.push(cells.slice(r * 3, r * 3 + 3).map((c, i) => `${icon(c)}`).join(''));
    }
    return rows.join('\n');
}

function winnerOf(cells) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6],
    ];
    for (const [a, b, c] of lines) {
        if (cells[a] && cells[a] === cells[b] && cells[b] === cells[c]) return cells[a];
    }
    if (cells.every(Boolean)) return 'draw';
    return null;
}

function pickRow(prefix) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}:bonbons`).setLabel('Bonbons').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${prefix}:citrouilles`).setLabel('Citrouilles').setStyle(ButtonStyle.Secondary),
    );
}

async function spawn(client, guild) {
    if (!isLive(guild.id) || quietHour()) return;
    if ([...running.values()].some((g) => g.guildId === guild.id)) return;
    const channelId = await generalId(guild);
    if (!channelId) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;

    const roll = Math.floor(Math.random() * 3);
    if (roll === 0) await spawnMorpion(channel, guild.id);
    else if (roll === 1) await spawnAuction(channel, guild.id);
    else await spawnRewrite(channel, guild.id);
}

async function spawnMorpion(channel, guildId) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('hw26:join').setLabel('Rejoindre le morpion').setStyle(ButtonStyle.Success),
    );
    const msg = await channel.send({
        content: '**Event Halloween — Morpion**\nLes 2 premiers à cliquer se battent. Le gagnant choisit 300 bonbons ou 100 citrouilles.',
        components: [row],
    });
    running.set(msg.id, { type: 'morpion', guildId, players: [], cells: Array(9).fill(null), turn: 0, channelId: channel.id });
}

async function spawnAuction(channel, guildId) {
    const msg = await channel.send(
        '**Event Halloween — Enchères** (1 min)\nÉcris juste un nombre : tes starss misés. La plus grosse mise gagne 500 bonbons ou 200 citrouilles (au choix).',
    );
    running.set(msg.id, { type: 'auction', guildId, channelId: channel.id, bids: [], ends: Date.now() + 60 * 1000 });
    setTimeout(() => closeAuction(channel.client, msg.id).catch(() => {}), 60 * 1000);
}

async function spawnRewrite(channel, guildId) {
    const msg = await channel.send('**Event Halloween — Réécris**\nDans 15 secondes une phrase apparaît. Le premier qui la recopie gagne.');
    const phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    running.set(msg.id, { type: 'rewrite', guildId, channelId: channel.id, phrase: null, ends: Date.now() + 45 * 1000 });
    setTimeout(async () => {
        const state = running.get(msg.id);
        if (!state || state.phrase) return;
        state.phrase = phrase;
        await channel.send(`Recopie exactement : \`${phrase}\``).catch(() => {});
    }, 15 * 1000);
    setTimeout(() => {
        const state = running.get(msg.id);
        if (!state || state.done) return;
        running.delete(msg.id);
        channel.send('Réécris terminé, personne.').catch(() => {});
    }, 45 * 1000);
}

async function payChoice(interaction, bonbons, citrouilles) {
    const which = interaction.customId.endsWith(':citrouilles') ? 'citrouilles' : 'bonbons';
    if (which === 'bonbons') grantEventCurrency(interaction.user.id, { bonbons });
    else grantEventCurrency(interaction.user.id, { citrouilles });
    await interaction.update({
        content: `${interaction.message.content}\n\nGagné par <@${interaction.user.id}> : ${which === 'bonbons' ? bonbons + ' bonbons' : citrouilles + ' citrouilles'}.`,
        components: [],
    });
}

async function onButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('hw26:')) return false;
    if (id === 'hw26:shop' || id.startsWith('hw26:buy:')) return false;

    if (id === 'hw26:streak:xp' || id === 'hw26:streak:role') {
        const { getOrCreateEventUser } = require('../utils/db-halloween');
        const { ROAD } = require('./config');
        const u = getOrCreateEventUser(interaction.user.id);
        if (u.streak_done) return interaction.reply({ content: 'Choix déjà fait.', ephemeral: true });
        if (store.completedCount(interaction.user.id) < ROAD.length) {
            return interaction.reply({ content: 'Il faut les 9 quêtes.', ephemeral: true });
        }
        if (id.endsWith(':xp')) {
            store.setFlag(interaction.user.id, 'perm_xp', 1);
            store.setFlag(interaction.user.id, 'streak_done', 1);
            return interaction.reply({ content: 'x2 EXP jusqu\'au prochain reset éco. C\'est noté.', ephemeral: true });
        }
        const { giveStreakRole } = require('./rewards');
        await giveStreakRole(interaction.member);
        return interaction.reply({ content: 'Rôle Fantôme d\'Halloween ajouté.', ephemeral: true });
    }

    if (id.startsWith('hw26:reward:')) {
        const stateId = interaction.message.id;
        const state = running.get(stateId);
        if (!state || state.winner !== interaction.user.id) {
            return interaction.reply({ content: 'Pas pour toi.', ephemeral: true });
        }
        const pack = state.reward;
        running.delete(stateId);
        await payChoice(interaction, pack.bonbons, pack.citrouilles);
        return true;
    }

    const state = [...running.entries()].find(([, s]) => s.channelId === interaction.channelId && s.type === 'morpion');
    if (!state) return interaction.reply({ content: 'Event fini.', ephemeral: true }).then(() => true);
    const [msgId, game] = state;

    if (id === 'hw26:join') {
        if (store.isCursed(interaction.user.id)) {
            return interaction.reply({ content: 'Tu es maudit par un fantôme, pas d\'event.', ephemeral: true });
        }
        if (game.players.includes(interaction.user.id)) {
            return interaction.reply({ content: 'Déjà inscrit.', ephemeral: true });
        }
        if (game.players.length >= 2) return interaction.reply({ content: 'Complet.', ephemeral: true });
        game.players.push(interaction.user.id);
        await progress(interaction.client, interaction.guild, interaction.user.id, 'event', 1);
        if (game.players.length < 2) {
            return interaction.reply({ content: 'Tu es joueur 1, on attend le 2e.', ephemeral: true });
        }
        const rows = [0, 1, 2].map((r) => new ActionRowBuilder().addComponents(
            [0, 1, 2].map((c) => new ButtonBuilder()
                .setCustomId(`hw26:cell:${r * 3 + c}`)
                .setLabel(`${r * 3 + c + 1}`)
                .setStyle(ButtonStyle.Secondary)),
        ));
        await interaction.update({
            content: `Morpion : <@${game.players[0]}> (X) vs <@${game.players[1]}> (O)\nTour de <@${game.players[0]}>\n${boardText(game.cells)}`,
            components: rows,
        });
        running.set(interaction.message.id, game);
        running.delete(msgId);
        if (interaction.message.id !== msgId) running.set(interaction.message.id, game);
        return true;
    }

    if (id.startsWith('hw26:cell:')) {
        const idx = Number(id.split(':')[2]);
        const player = game.players[game.turn % 2];
        if (interaction.user.id !== player) return interaction.reply({ content: 'Pas ton tour.', ephemeral: true });
        if (game.cells[idx]) return interaction.reply({ content: 'Case prise.', ephemeral: true });
        game.cells[idx] = game.turn % 2 === 0 ? 'X' : 'O';
        game.turn += 1;
        const win = winnerOf(game.cells);
        if (!win) {
            const rows = [0, 1, 2].map((r) => new ActionRowBuilder().addComponents(
                [0, 1, 2].map((c) => new ButtonBuilder()
                    .setCustomId(`hw26:cell:${r * 3 + c}`)
                    .setLabel(`${r * 3 + c + 1}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(Boolean(game.cells[r * 3 + c]))),
            ));
            await interaction.update({
                content: `Morpion : <@${game.players[0]}> (X) vs <@${game.players[1]}> (O)\nTour de <@${game.players[game.turn % 2]}>\n${boardText(game.cells)}`,
                components: rows,
            });
            return true;
        }
        if (win === 'draw') {
            running.delete(interaction.message.id);
            await interaction.update({ content: 'Morpion nul, pas de lot.', components: [] });
            return true;
        }
        const winnerId = win === 'X' ? game.players[0] : game.players[1];
        game.winner = winnerId;
        game.reward = { bonbons: 300, citrouilles: 100 };
        running.set(interaction.message.id, game);
        await interaction.update({
            content: `Morpion fini. <@${winnerId}> choisit.`,
            components: [pickRow('hw26:reward')],
        });
        return true;
    }

    return false;
}

async function handleChatEvent(message) {
    if (store.isCursed(message.author.id)) return;
    for (const [id, state] of running) {
        if (state.channelId !== message.channel.id) continue;
        if (state.type === 'auction' && Date.now() < state.ends) {
            const n = Number(message.content.trim());
            if (!Number.isInteger(n) || n <= 0) continue;
            state.bids.push({ userId: message.author.id, amount: n });
            await progress(message.client, message.guild, message.author.id, 'event', 1);
        }
        if (state.type === 'rewrite' && state.phrase && !state.done) {
            if (message.content.trim().toLowerCase() !== state.phrase.toLowerCase()) continue;
            state.done = true;
            state.winner = message.author.id;
            state.reward = { bonbons: 450, citrouilles: 150 };
            await progress(message.client, message.guild, message.author.id, 'event', 1);
            const row = pickRow('hw26:reward');
            const sent = await message.channel.send({
                content: `<@${message.author.id}> a recopié. Choisis ta récompense.`,
                components: [row],
            });
            running.delete(id);
            running.set(sent.id, state);
        }
    }
}

async function closeAuction(client, msgId) {
    const state = running.get(msgId);
    if (!state || state.type !== 'auction') return;
    running.delete(msgId);
    const channel = await client.channels.fetch(state.channelId).catch(() => null);
    if (!channel) return;
    const mainDb = require('../database/database');
    const ranked = [...state.bids].sort((a, b) => b.amount - a.amount);
    for (const bid of ranked) {
        const user = mainDb.prepare('SELECT stars FROM users WHERE id = ?').get(bid.userId);
        if (!user || user.stars < bid.amount) continue;
        mainDb.prepare('UPDATE users SET stars = stars - ? WHERE id = ?').run(bid.amount, bid.userId);
        state.winner = bid.userId;
        state.reward = { bonbons: 500, citrouilles: 200 };
        const sent = await channel.send({
            content: `Enchères : <@${bid.userId}> remporte avec ${bid.amount} starss. Choisis.`,
            components: [pickRow('hw26:reward')],
        });
        running.set(sent.id, state);
        return;
    }
    await channel.send('Enchères finies, aucune mise valide.');
}

function startEvents(client) {
    setInterval(async () => {
        const p = parisParts();
        if (p.minute !== 0 || quietHour()) return;
        const { TEST_GUILD_ID, MAIN_GUILD_ID } = require('./config');
        for (const id of [TEST_GUILD_ID, MAIN_GUILD_ID]) {
            if (!isLive(id)) continue;
            const guild = client.guilds.cache.get(id);
            if (guild) await spawn(client, guild).catch(() => {});
        }
    }, 20 * 1000);
}

module.exports = { onButton, handleChatEvent, startEvents, spawn };
