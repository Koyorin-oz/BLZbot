const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    AttachmentBuilder,
    ComponentType,
} = require('discord.js');
const { SHOP } = require('../../halloween2026/config');
const { isLive } = require('../../halloween2026/live');
const { grantEventCurrency, getOrCreateEventUser } = require('../../utils/db-halloween');
const { progress, giveShopRole } = require('../../halloween2026/rewards');
const store = require('../../halloween2026/store');
const { getOrCreateUser } = require('../../utils/db-users');
const fs = require('fs');
const path = require('path');

function priceLine(item) {
    const bits = [];
    if (item.bonbons != null) bits.push(`**${item.bonbons.toLocaleString('fr-FR')}** bonbons`);
    if (item.citrouilles != null) bits.push(`**${item.citrouilles.toLocaleString('fr-FR')}** citrouilles`);
    return bits.join('  ou  ');
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
    grantEventCurrency(interaction.user.id, { [currency]: -price });
    const mainDb = require('../../database/database');
    getOrCreateUser(interaction.user.id, interaction.user.username);
    const until = Date.now() + 60 * 60 * 1000;
    if (item.kind === 'role') await giveShopRole(interaction.member, item);
    else if (item.kind === 'boost_xp') mainDb.prepare('UPDATE users SET xp_boost_until = ? WHERE id = ?').run(until, interaction.user.id);
    else if (item.kind === 'boost_stars') mainDb.prepare('UPDATE users SET stars_boost_until = ? WHERE id = ?').run(until, interaction.user.id);
    else if (item.kind === 'item_fantome') store.addItem(interaction.user.id, 'fantomes', 1);
    else if (item.kind === 'item_collier') store.addItem(interaction.user.id, 'colliers', 3);
    await progress(interaction.client, interaction.guild, interaction.user.id, 'shop', 1);
    if (item.kind === 'role') await progress(interaction.client, interaction.guild, interaction.user.id, 'roles', 1);
    const unit = currency === 'bonbons' ? 'bonbons' : 'citrouilles';
    return `Acheté : **${item.name}** (${price.toLocaleString('fr-FR')} ${unit}).`;
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
            const { MediaGalleryBuilder } = require('discord.js');
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems({ media: { url: 'attachment://halloween-shop.jpg' } }),
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `Bonbons : **${user.bonbons.toLocaleString('fr-FR')}**  ·  Citrouilles : **${user.citrouilles.toLocaleString('fr-FR')}**\n` +
                    `Fantômes : **${user.fantomes || 0}**  ·  Charges collier : **${user.colliers || 0}**`,
                ),
            );

            for (const item of SHOP) {
                const owned = item.kind === 'role' && interaction.member.roles.cache.some((r) => r.name === item.name);
                const affordable = canPay(user, item);
                let label = 'Acheter';
                let style = ButtonStyle.Success;
                let disabled = false;
                if (owned) {
                    label = 'Possédé';
                    style = ButtonStyle.Secondary;
                    disabled = true;
                } else if (!affordable) {
                    label = 'Pas assez';
                    style = ButtonStyle.Secondary;
                    disabled = true;
                }
                const both = item.bonbons != null && item.citrouilles != null;
                const only = item.bonbons != null ? 'bonbons' : 'citrouilles';
                const button = new ButtonBuilder()
                    .setCustomId(both ? `hw26:pick:${item.id}` : `hw26:buy:${item.id}:${only}`)
                    .setLabel(label)
                    .setStyle(style)
                    .setDisabled(disabled);
                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `### ${item.emoji} ${item.name}\n**Prix :** ${priceLine(item)}\n${item.blurb}`,
                        ))
                        .setButtonAccessory(button),
                );
            }

            return {
                components: [container],
                files: [new AttachmentBuilder(banner, { name: 'halloween-shop.jpg' })],
                flags: 32768,
                ephemeral: true,
            };
        };

        const response = await interaction.reply(payload());
        const collector = response.createMessageComponentCollector({ time: 5 * 60 * 1000 });

        collector.on('collect', async (i) => {
            if (i.user.id !== userId) {
                return i.reply({ content: 'Pas ta boutique.', ephemeral: true });
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
                    const msg = await applyBuy(b, item, currency);
                    await b.update({ content: msg, components: [] });
                    await interaction.editReply(payload()).catch(() => {});
                });
                return;
            }
            if (!i.customId.startsWith('hw26:buy:')) return;
            const [, , itemId, currency] = i.customId.split(':');
            const item = SHOP.find((s) => s.id === itemId);
            const msg = await applyBuy(i, item, currency);
            await i.deferUpdate();
            await interaction.editReply(payload());
            await i.followUp({ content: msg, ephemeral: true }).catch(() => {});
        });
    },
};
