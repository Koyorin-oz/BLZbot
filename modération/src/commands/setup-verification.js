/**
 * /setup-verification — Panneau admin pour configurer le système de vérification OAuth.
 *
 * Réservé aux **administrateurs**. Permet de choisir :
 *  - le salon où poster le panneau public (avec bouton 🔐 Vérifier)
 *  - le rôle attribué automatiquement après vérification
 *  - le salon où loguer les vérifications (sans IP)
 *  - le contenu de l'embed du panneau public (titre / description / couleur)
 *
 * Les logs **avec IP** sont envoyés en DM aux IDs listés dans `OWNER_DM_IDS` (.env),
 * pas dans un salon — c'est pour ça que la commande ne demande pas de "salon logs IP".
 *
 * La logique des composants (menus, modal, bouton "Publier") est gérée par
 * `src/lib/verification/index.js` via `installVerificationSystem`.
 */
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
} = require('discord.js');
const {
    getGuildConfig,
} = require('../lib/verification/database');
const { describeConfig, buildSetupRows } = require('../lib/verification');

module.exports = {
    // Déploiement guild-only (jamais en global) : l'app Discord est proche des 100
    // commandes globales et ce flag évite de consommer un slot global.
    // Voir `src/utils/deploy-slash-commands.js` → GUILD_ONLY_BY_COMMAND pour la liste
    // des guildes cibles.
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('setup-verification')
        .setDescription('Panneau admin : salon du bouton, rôle, salon logs, contenu de l’embed.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                content: 'Utilisable uniquement sur un serveur.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({
                content: 'Réservé aux membres avec la permission **Administrateur**.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const cfg = getGuildConfig(interaction.guild.id);
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('Configuration — vérification')
                    .setDescription(describeConfig(cfg))
                    .setColor(0x5865f2),
            ],
            components: buildSetupRows(),
            flags: MessageFlags.Ephemeral,
        });
    },
};
