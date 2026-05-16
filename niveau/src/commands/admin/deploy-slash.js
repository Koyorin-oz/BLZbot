/**
 * [Admin] Re-pousse toutes les slash sur Discord (niveau + fusion REBORN).
 * Utile sur PebbleHost sans accès console : pas besoin de npm, juste cette commande après un redémarrage.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const deployCommands = require('../../utils/deploy-commands');
const { collectRebornSlashMap, isEnabled, rebornAvailable } = require('../../utils/reborn-integration');
const { isBotOwner } = require('../../utils/bot-owner');

const REBORN_CHECK = ['salon-hacker', 'admin-roles', 'itemindex', 'daily', 'boutique'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deploy-slash')
        .setDescription('[Admin] Met à jour les commandes slash sur Discord (inclut REBORN).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!isBotOwner(interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: 'Réservé aux administrateurs du serveur (ou owner du bot).',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        let preMsg = '';
        if (isEnabled() && !rebornAvailable()) {
            preMsg =
                '⚠️ Dossier `reborn-test-bot` absent sur l’hébergeur — seules les commandes niveau seront poussées.\n';
        } else if (isEnabled()) {
            const map = collectRebornSlashMap();
            const present = REBORN_CHECK.map((n) => `${n}:${map.has(n) ? '✓' : '✗'}`).join(' · ');
            preMsg = `REBORN local : **${map.size}** cmd — ${present}\n\n`;
        }

        try {
            await deployCommands(interaction.client);
            await interaction.editReply({
                content:
                    `${preMsg}✅ **Deploy terminé.** Recharge Discord (Ctrl+Maj+R) si /salon-hacker n’apparaît pas tout de suite (sync globale ~1–5 min).`,
            });
        } catch (e) {
            await interaction.editReply({
                content: `${preMsg}❌ Échec deploy : ${e?.message || e}`,
            });
        }
    },
};
