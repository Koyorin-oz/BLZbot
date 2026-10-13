const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { SHOP } = require('../../halloween2026/config');
const { isLive } = require('../../halloween2026/live');
const { grantEventCurrency, getOrCreateEventUser } = require('../../utils/db-halloween');
const { progress, giveShopRole } = require('../../halloween2026/rewards');
const store = require('../../halloween2026/store');
const { getOrCreateUser } = require('../../utils/db-users');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('halloween-boutique')
        .setDescription('Boutique Halloween (bonbons ou citrouilles).'),

    async execute(interaction) {
        if (!isLive(interaction.guildId)) {
            return interaction.reply({ content: 'Update Halloween pas encore sur ce serveur.', ephemeral: true });
        }
        const user = getOrCreateEventUser(interaction.user.id, interaction.user.username);
        const embed = new EmbedBuilder()
            .setTitle('Boutique Halloween')
            .setColor(0xe67e22)
            .setDescription(`Bonbons : **${user.bonbons}** · Citrouilles : **${user.citrouilles}**\nFantômes : ${user.fantomes || 0} · Charges collier : ${user.colliers || 0}`);

        for (const item of SHOP) {
            const prices = [
                item.bonbons != null ? `${item.bonbons} bonbons` : null,
                item.citrouilles != null ? `${item.citrouilles} citrouilles` : null,
            ].filter(Boolean).join(' ou ');
            embed.addFields({ name: item.name, value: prices });
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId('hw26:shop')
            .setPlaceholder('Choisir un article')
            .addOptions(SHOP.map((item) => ({ label: item.name.slice(0, 100), value: item.id })));

        const msg = await interaction.reply({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(menu)],
            ephemeral: true,
            fetchReply: true,
        });

        const collector = msg.createMessageComponentCollector({ time: 120000 });
        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: 'Pas ton menu.', ephemeral: true });
            if (i.customId === 'hw26:shop') {
                const item = SHOP.find((s) => s.id === i.values[0]);
                const buttons = [];
                if (item.bonbons != null) {
                    buttons.push(new ButtonBuilder().setCustomId(`hw26:buy:${item.id}:bonbons`).setLabel(`${item.bonbons} bonbons`).setStyle(ButtonStyle.Primary));
                }
                if (item.citrouilles != null) {
                    buttons.push(new ButtonBuilder().setCustomId(`hw26:buy:${item.id}:citrouilles`).setLabel(`${item.citrouilles} citrouilles`).setStyle(ButtonStyle.Secondary));
                }
                return i.update({ components: [new ActionRowBuilder().addComponents(buttons)] });
            }
            if (!i.customId.startsWith('hw26:buy:')) return;
            const [, , itemId, currency] = i.customId.split(':');
            const item = SHOP.find((s) => s.id === itemId);
            const price = item[currency];
            const current = getOrCreateEventUser(i.user.id, i.user.username);
            if ((current[currency] || 0) < price) {
                return i.reply({ content: 'Pas assez.', ephemeral: true });
            }
            if (item.kind === 'role' && i.member.roles.cache.some((r) => r.name === item.name)) {
                return i.reply({ content: 'Tu as déjà ce rôle.', ephemeral: true });
            }
            grantEventCurrency(i.user.id, { [currency]: -price });
            const mainDb = require('../../database/database');
            getOrCreateUser(i.user.id, i.user.username);
            const until = Date.now() + 60 * 60 * 1000;
            if (item.kind === 'role') await giveShopRole(i.member, item);
            else if (item.kind === 'boost_xp') mainDb.prepare('UPDATE users SET xp_boost_until = ? WHERE id = ?').run(until, i.user.id);
            else if (item.kind === 'boost_stars') mainDb.prepare('UPDATE users SET stars_boost_until = ? WHERE id = ?').run(until, i.user.id);
            else if (item.kind === 'item_fantome') store.addItem(i.user.id, 'fantomes', 1);
            else if (item.kind === 'item_collier') store.addItem(i.user.id, 'colliers', 3);
            await progress(i.client, i.guild, i.user.id, 'shop', 1);
            if (item.kind === 'role') await progress(i.client, i.guild, i.user.id, 'roles', 1);
            return i.update({ content: `Acheté : ${item.name}.`, embeds: [], components: [] });
        });
    },
};
