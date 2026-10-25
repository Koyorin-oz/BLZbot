const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    AttachmentBuilder,
    MediaGalleryBuilder,
    ComponentType,
} = require('discord.js');
const { SHOP } = require('../../halloween2026/config');
const { isLive } = require('../../halloween2026/live');
const { grantEventCurrency, getOrCreateEventUser } = require('../../utils/db-halloween');
const { progress, giveShopRole, addBoostHour } = require('../../halloween2026/rewards');
const store = require('../../halloween2026/store');
const { getOrCreateUser } = require('../../utils/db-users');
const fs = require('fs');
const path = require('path');

function priceLine(item) {
    const bits = [];
    if (item.bonbons != null) bits.push(`${item.bonbons.toLocaleString('fr-FR')} Bonbons 🍬`);
    if (item.citrouilles != null) bits.push(`${item.citrouilles.toLocaleString('fr-FR')} Citrouilles 🎃`);
    return bits.join(' ou ');
}

function canPay(user, item) {
    const bonbons = item.bonbons != null && user.bonbons >= item.bonbons;
    const citrouilles = item.citrouilles != null && user.citrouilles >= item.citrouilles;
    return bonbons || citrouilles;
}

async function applyBuy(interaction, item, currency) {
    const price = item[currency];
    const current = getOrCreateEventUser(interaction.user.id, interaction.user.username);
    if ((current[currency] || 0) < price) return 'Pas assez.';
    if (item.kind === 'role' && interaction.member.roles.cache.some((r) => r.name === item.name)) {
        return 'Tu as déjà ce rôle.';
    }
    if (item.kind === 'role') {
        try {
            await giveShopRole(interaction.member, item);
        } catch {
            return 'Le bot n\'a pas pu donner le rôle (permission Gérer les rôles). Rien n\'a été débité.';
        }
    }
    grantEventCurrency(interaction.user.id, { [currency]: -price });
    getOrCreateUser(interaction.user.id, interaction.user.username);
    if (item.kind === 'boost_xp') addBoostHour(interaction.user.id, 'xp_boost_until');
    else if (item.kind === 'boost_stars') addBoostHour(interaction.user.id, 'stars_boost_until');
    else if (item.kind === 'item_fantome') store.addItem(interaction.user.id, 'fantomes', 1);
    else if (item.kind === 'item_collier') store.addItem(interaction.user.id, 'colliers', 3);
    await progress(interaction.client, interaction.guild, interaction.user.id, 'shop', 1);
    if (item.kind === 'role') await progress(interaction.client, interaction.guild, interaction.user.id, 'roles', 1);
    const unit = currency === 'bonbons' ? 'bonbons' : 'citrouilles';
    return `Acheté : **${item.name}** (${price.toLocaleString('fr-FR')} ${unit}).`;
}

const buying = new Set();

async function buyOnce(interaction, item, currency) {
    if (buying.has(interaction.user.id)) return 'Achat déjà en cours.';
    buying.add(interaction.user.id);
    try {
        return await applyBuy(interaction, item, currency);
    } finally {
        buying.delete(interaction.user.id);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('halloween-boutique')
        .setDescription('Boutique Halloween (bonbons ou citrouilles).'),

    async execute(interaction) {
        if (!isLive(interaction.guildId)) {
            return interaction.reply({ content: 'Update Halloween pas encore sur ce serveur.', ephemeral: true });
        }

        const bannerPath = path.join(__dirname, '..', '..', 'assets', 'halloween_boutique_banner.jpg');
        const banner = fs.readFileSync(bannerPath);
        const userId = interaction.user.id;

        const payload = () => {
            const user = getOrCreateEventUser(userId, interaction.user.username);
            const container = new ContainerBuilder();
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems({ media: { url: 'attachment://halloween-shop.jpg' } }),
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `Votre solde : **${user.bonbons.toLocaleString('fr-FR')}** Bonbons 🍬 · **${user.citrouilles.toLocaleString('fr-FR')}** Citrouilles 🎃`,
                ),
            );

            for (const item of SHOP) {
                const owned = item.kind === 'role' && interaction.member.roles.cache.some((r) => r.name === item.name);
                let description = `**Prix:** ${priceLine(item)}\n${item.description}`;
                let label = 'Acheter';
                let style = ButtonStyle.Success;
                if (owned) {
                    label = 'Possédé';
                    style = ButtonStyle.Secondary;
                    description += '\n✅ **Déjà possédé**';
                } else {
                    description += `\n*${item.info}*`;
                }
                if (item.kind === 'item_fantome') description += ` · *En stock : ${user.fantomes || 0}*`;
                if (item.kind === 'item_collier') description += ` · *Charges : ${user.colliers || 0}*`;

                const both = item.bonbons != null && item.citrouilles != null;
                const only = item.bonbons != null ? 'bonbons' : 'citrouilles';
                const button = new ButtonBuilder()
                    .setCustomId(both ? `hw26:pick:${item.id}` : `hw26:buy:${item.id}:${only}`)
                    .setLabel(label)
                    .setStyle(style)
                    .setEmoji('🎃')
                    .setDisabled(owned || !canPay(user, item));
                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${item.emoji} ${item.name}\n${description}`))
                        .setButtonAccessory(button),
                );
            }

            const nav = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('hw26:shop:prev').setLabel('◀️ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('hw26:shop:page').setLabel('Page 1/1').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('hw26:shop:next').setLabel('Suivant ▶️').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('hw26:shop:road').setLabel('🛣️ Road Halloween').setStyle(ButtonStyle.Primary),
            );

            return { components: [container, nav], flags: 32768 };
        };

        const response = await interaction.reply({
            ...payload(),
            files: [new AttachmentBuilder(banner, { name: 'halloween-shop.jpg' })],
        });
        const announce = (i, msg) => (msg.startsWith('Acheté')
            ? i.followUp({ content: `${i.user} ${msg}` })
            : i.followUp({ content: msg, ephemeral: true })).catch(() => {});
        const collector = response.createMessageComponentCollector({ time: 5 * 60 * 1000 });

        collector.on('collect', async (i) => {
            if (i.user.id !== userId) {
                return i.reply({ content: 'Pas ta boutique.', ephemeral: true });
            }
            if (i.customId === 'hw26:shop:road') {
                return require('./halloween-road').execute(i);
            }
            if (i.customId.startsWith('hw26:pick:')) {
                const item = SHOP.find((s) => s.id === i.customId.split(':')[2]);
                const row = new ActionRowBuilder();
                if (item.bonbons != null) {
                    row.addComponents(new ButtonBuilder()
                        .setCustomId(`hw26:buy:${item.id}:bonbons`)
                        .setLabel(`${item.bonbons.toLocaleString('fr-FR')} bonbons`)
                        .setStyle(ButtonStyle.Primary));
                }
                if (item.citrouilles != null) {
                    row.addComponents(new ButtonBuilder()
                        .setCustomId(`hw26:buy:${item.id}:citrouilles`)
                        .setLabel(`${item.citrouilles.toLocaleString('fr-FR')} citrouilles`)
                        .setStyle(ButtonStyle.Secondary));
                }
                const pickMsg = await i.reply({
                    content: `**${item.emoji} ${item.name}** — tu paies avec quoi ?`,
                    components: [row],
                    ephemeral: true,
                    fetchReply: true,
                });
                const sub = pickMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000, max: 1 });
                sub.on('collect', async (b) => {
                    const currency = b.customId.endsWith(':citrouilles') ? 'citrouilles' : 'bonbons';
                    await b.deferUpdate();
                    const msg = await buyOnce(b, item, currency);
                    await b.editReply({ content: msg, components: [] }).catch(() => {});
                    await interaction.editReply(payload()).catch(() => {});
                    if (msg.startsWith('Acheté')) await announce(b, msg);
                });
                return;
            }
            if (!i.customId.startsWith('hw26:buy:')) return;
            const [, , itemId, currency] = i.customId.split(':');
            const item = SHOP.find((s) => s.id === itemId);
            await i.deferUpdate();
            const msg = await buyOnce(i, item, currency);
            await interaction.editReply(payload()).catch(() => {});
            await announce(i, msg);
        });
    },
};
