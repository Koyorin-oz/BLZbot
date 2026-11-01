const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require('discord.js');
const { PHRASES, COLOR, parisParts, eventRunning } = require('./config');
const { generalChannel, progress } = require('./rewards');
const { isLive } = require('./live');
const { grantEventCurrency } = require('../utils/db-halloween');
const store = require('./store');

const MIN = 60 * 1000;
const FOOTER = { text: 'Event Halloween 2026 · un event par heure (sauf 1h–9h)' };

/** Premier clic gagne. `rewards` : une est tirée au hasard au spawn. */
const DROPS = [
    {
        emoji: '🎃',
        color: COLOR.orange,
        title: 'Une citrouille géante roule dans le salon !',
        text: 'Elle file vite… le **premier** qui clique la garde pour lui.',
        button: 'Attraper la citrouille',
        rewards: [{ citrouilles: 150 }],
    },
    {
        emoji: '🍬',
        color: 0xff5fa2,
        title: 'Un sac de bonbons est tombé !',
        text: 'Quelqu\'un l\'a oublié ici. **Premier arrivé, premier servi.**',
        button: 'Ramasser les bonbons',
        rewards: [{ bonbons: 450 }],
    },
    {
        emoji: '👻',
        color: COLOR.purple,
        title: 'Un fantôme farceur traverse le salon !',
        text: 'Il transporte un petit butin. Attrape-le avant qu\'il disparaisse !',
        button: 'Attraper le fantôme',
        rewards: [{ bonbons: 300, citrouilles: 100 }],
    },
    {
        emoji: '🧪',
        color: COLOR.green,
        title: 'Un chaudron de sorcière bouillonne…',
        text: 'Plonge la main dedans… mais personne ne sait ce qu\'il y a au fond.',
        button: 'Plonger la main',
        mystery: true,
        rewards: [{ bonbons: 200 }, { bonbons: 700 }, { citrouilles: 80 }, { citrouilles: 250 }],
    },
];

/** @type {Map<string, any>} messageId -> état */
const running = new Map();
/** @type {Map<string, string>} guildId -> "date:hour" du dernier spawn */
const lastSpawn = new Map();

function quietHour() {
    const h = parisParts().hour;
    return h >= 1 && h < 9;
}

/** @here sur le premier event du jour seulement (date Paris, gardée en base pour survivre aux redémarrages). */
function hereOnce(guildId) {
    const today = parisParts().date;
    const key = `here:${guildId}`;
    if (store.meta(key) === today) return {};
    store.meta(key, today);
    return { content: '@here', allowedMentions: { parse: ['everyone'] } };
}

function rewardText(r) {
    const bits = [];
    if (r.bonbons) bits.push(`**${r.bonbons.toLocaleString('fr-FR')}** 🍬 bonbons`);
    if (r.citrouilles) bits.push(`**${r.citrouilles.toLocaleString('fr-FR')}** 🎃 citrouilles`);
    return bits.join(' + ');
}

function closedEmbed(message, field) {
    const base = message.embeds?.[0] ? EmbedBuilder.from(message.embeds[0]) : new EmbedBuilder();
    return base.addFields(field);
}

const KINDS = ['citrouille', 'bonbons', 'fantome', 'chaudron', 'phrase'];

/**
 * @param {{ force?: boolean, kind?: string }} [opts] force : ignore la pause de nuit (commande admin)
 * @returns {Promise<string>} 'ok' | 'busy' | 'quiet' | 'off' | 'nochannel'
 */
async function spawn(client, guild, { force = false, kind = null } = {}) {
    if (!isLive(guild.id)) return 'off';
    if (!force && quietHour()) return 'quiet';
    if ([...running.values()].some((s) => s.guildId === guild.id)) return 'busy';
    const channel = await generalChannel(guild);
    if (!channel) return 'nochannel';

    const index = kind ? KINDS.indexOf(kind) : Math.floor(Math.random() * KINDS.length);
    if (index < DROPS.length) await spawnDrop(channel, guild.id, DROPS[index]);
    else await spawnRewrite(channel, guild.id);
    return 'ok';
}

async function spawnDrop(channel, guildId, drop) {
    const reward = drop.rewards[Math.floor(Math.random() * drop.rewards.length)];
    const embed = new EmbedBuilder()
        .setColor(drop.color)
        .setTitle(`${drop.emoji} ${drop.title}`)
        .setDescription(drop.text)
        .addFields({ name: '🎁 Récompense', value: drop.mystery ? '❓ **Mystère…**' : rewardText(reward) })
        .setFooter(FOOTER);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('hw26:grab').setLabel(drop.button).setEmoji(drop.emoji).setStyle(ButtonStyle.Success),
    );
    const msg = await channel.send({ ...hereOnce(guildId), embeds: [embed], components: [row] });
    running.set(msg.id, { type: 'drop', guildId, channelId: channel.id, reward, expires: Date.now() + 5 * MIN });
}

async function spawnRewrite(channel, guildId) {
    const phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    const embed = new EmbedBuilder()
        .setColor(COLOR.red)
        .setTitle('✍️ Réécris la phrase !')
        .setDescription('Dans **15 secondes**, une phrase va apparaître ici.\nLe **premier** qui la recopie exactement gagne.')
        .addFields({ name: '🎁 Récompense', value: `Au choix : ${rewardText({ bonbons: 450 })} ou ${rewardText({ citrouilles: 150 })}` })
        .setFooter(FOOTER);
    const msg = await channel.send({ ...hereOnce(guildId), embeds: [embed] });
    running.set(msg.id, { type: 'rewrite', guildId, channelId: channel.id, phrase: null, expires: Date.now() + MIN });

    setTimeout(async () => {
        const state = running.get(msg.id);
        if (!state || state.phrase) return;
        state.phrase = phrase;
        await msg.edit({
            embeds: [EmbedBuilder.from(embed).setDescription(`Recopie exactement :\n# \`${phrase}\``)],
        }).catch(() => {});
    }, 15 * 1000);
    setTimeout(async () => {
        const state = running.get(msg.id);
        if (!state || state.done) return;
        running.delete(msg.id);
        await msg.edit({
            embeds: [closedEmbed(msg, { name: '⌛ Terminé', value: 'Personne n\'a recopié à temps.' }).setColor(0x555555)],
        }).catch(() => {});
    }, 45 * 1000);
}

function pickRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('hw26:reward:bonbons').setLabel('Bonbons').setEmoji('🍬').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('hw26:reward:citrouilles').setLabel('Citrouilles').setEmoji('🎃').setStyle(ButtonStyle.Secondary),
    );
}

async function onButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('hw26:')) return false;
    if (id.startsWith('hw26:shop') || id.startsWith('hw26:buy:') || id.startsWith('hw26:pick:')) return false;

    if (id === 'hw26:streak:xp' || id === 'hw26:streak:role') {
        const { getOrCreateEventUser } = require('../utils/db-halloween');
        const { ROAD } = require('./config');
        require('./rewards').ensureMissed(interaction.user.id);
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

    const state = running.get(interaction.message.id);

    if (id === 'hw26:grab') {
        if (!state || state.done) return interaction.reply({ content: 'Trop tard, quelqu\'un l\'a déjà pris.', ephemeral: true });
        if (store.isCursed(interaction.user.id)) {
            return interaction.reply({ content: '👻 Tu es maudit par un fantôme, pas d\'event pour toi.', ephemeral: true });
        }
        state.done = true;
        running.delete(interaction.message.id);
        grantEventCurrency(interaction.user.id, state.reward);
        await interaction.update({
            embeds: [closedEmbed(interaction.message, { name: '🏆 Gagnant', value: `${interaction.user} remporte ${rewardText(state.reward)} !` }).setColor(0x555555)],
            components: [],
        });
        await progress(interaction.client, interaction.guild, interaction.user.id, 'event', 1);
        return true;
    }

    if (id.startsWith('hw26:reward:')) {
        if (!state) return interaction.reply({ content: 'Trop tard, la récompense a expiré.', ephemeral: true });
        if (state.winner !== interaction.user.id) return interaction.reply({ content: 'Pas pour toi.', ephemeral: true });
        running.delete(interaction.message.id);
        const which = id.endsWith(':citrouilles') ? 'citrouilles' : 'bonbons';
        const gain = { [which]: state.reward[which] };
        grantEventCurrency(interaction.user.id, gain);
        await interaction.update({
            embeds: [closedEmbed(interaction.message, { name: '🎁 Choisi', value: `${interaction.user} prend ${rewardText(gain)} !` })],
            components: [],
        });
        return true;
    }

    await interaction.reply({ content: 'Cet event est terminé.', ephemeral: true });
    return true;
}

async function handleChatEvent(message) {
    if (store.isCursed(message.author.id)) return;
    for (const [id, state] of running) {
        if (state.type !== 'rewrite' || state.channelId !== message.channel.id) continue;
        if (!state.phrase || state.done) continue;
        if (message.content.trim().toLowerCase() !== state.phrase.toLowerCase()) continue;
        state.done = true;
        running.delete(id);
        await progress(message.client, message.guild, message.author.id, 'event', 1);
        const embed = new EmbedBuilder()
            .setColor(COLOR.orange)
            .setTitle('✍️ Phrase recopiée !')
            .setDescription(`${message.author} a été le plus rapide.\nChoisis ta récompense :`)
            .addFields(
                { name: '🍬 Bonbons', value: rewardText({ bonbons: 450 }), inline: true },
                { name: '🎃 Citrouilles', value: rewardText({ citrouilles: 150 }), inline: true },
            )
            .setFooter(FOOTER);
        const sent = await message.channel.send({ embeds: [embed], components: [pickRow()] });
        running.set(sent.id, {
            type: 'reward',
            guildId: state.guildId,
            channelId: message.channel.id,
            winner: message.author.id,
            reward: { bonbons: 450, citrouilles: 150 },
            expires: Date.now() + 2 * MIN,
        });
    }
}

/** Ferme les events abandonnés ; une récompense jamais choisie part en bonbons. */
async function sweep(client) {
    const now = Date.now();
    for (const [id, s] of [...running.entries()]) {
        if (!s.expires || s.expires > now) continue;
        running.delete(id);
        let field = { name: '⌛ Expiré', value: 'Personne n\'a cliqué à temps.' };
        if (s.type === 'reward') {
            grantEventCurrency(s.winner, { bonbons: s.reward.bonbons });
            field = { name: '🎁 Pas de choix', value: `<@${s.winner}> reçoit ${rewardText({ bonbons: s.reward.bonbons })}.` };
        }
        const ch = client.channels.cache.get(s.channelId);
        const msg = ch?.messages ? await ch.messages.fetch(id).catch(() => null) : null;
        if (msg?.editable) await msg.edit({ embeds: [closedEmbed(msg, field).setColor(0x555555)], components: [] }).catch(() => {});
    }
}

function startEvents(client) {
    setInterval(async () => {
        await sweep(client).catch(() => {});
        const p = parisParts();
        if (p.minute !== 0 || quietHour() || !eventRunning()) return;
        const slot = `${p.date}:${p.hour}`;
        const { TEST_GUILD_ID, MAIN_GUILD_ID } = require('./config');
        for (const id of [TEST_GUILD_ID, MAIN_GUILD_ID]) {
            if (!isLive(id) || lastSpawn.get(id) === slot) continue;
            const guild = client.guilds.cache.get(id);
            if (!guild) continue;
            lastSpawn.set(id, slot);
            await spawn(client, guild).catch(() => {});
        }
    }, 20 * 1000);
}

module.exports = { onButton, handleChatEvent, startEvents, spawn, KINDS };
