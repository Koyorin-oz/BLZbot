/**
 * /verify — Commande de secours pour obtenir le lien de vérification OAuth.
 *
 * Équivalent au bouton 🔐 Vérifier du panneau public : si le membre est déjà vérifié,
 * on lui réattribue le rôle ; sinon on lui DM le lien éphémère vers `/oauth/start?state=...`.
 *
 * Si la guilde n'a pas configuré la vérification (rôle vérifié manquant), on renvoie
 * vers `/setup-verification` (admin requis).
 *
 * Le secret HMAC `OAUTH_STATE_SECRET` et la `PUBLIC_BASE_URL` sont lus depuis l'env —
 * on garde ces deux valeurs ici (et pas en config du module) parce qu'elles changent
 * en dev/prod et doivent rester hors du code source.
 */
const {
    SlashCommandBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const {
    getGuildConfig,
    findVerifiedInGuild,
} = require('../lib/verification/database');
const { addGuildMemberRole } = require('../lib/verification/discordApi');
const { buildVerifyUrl } = require('../lib/verification');

module.exports = {
    // Déploiement guild-only (jamais en global) : l'app Discord est proche des 100
    // commandes globales et ce flag évite de consommer un slot global.
    // Voir `src/utils/deploy-slash-commands.js` → GUILD_ONLY_BY_COMMAND pour la liste
    // des guildes cibles.
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Obtenir le lien de vérification (anti double-compte par IP).'),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                content: 'À utiliser sur un serveur.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const cfg = getGuildConfig(interaction.guild.id);
        if (!cfg?.verified_role_id) {
            await interaction.reply({
                content:
                    "Ce serveur n'a pas encore configuré la vérification. Demande à un **administrateur** d'utiliser `/setup-verification`.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        let member = interaction.member;
        if (!member) member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
            await interaction.reply({
                content: 'Impossible de charger ton profil sur ce serveur. Réessaie dans un instant.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (member.roles.cache.has(cfg.verified_role_id)) {
            await interaction.reply({
                content: 'Tu as déjà le rôle vérifié.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const row = findVerifiedInGuild(interaction.guild.id, interaction.user.id);
        if (row) {
            try {
                await addGuildMemberRole(
                    interaction.client.token,
                    interaction.guild.id,
                    interaction.user.id,
                    cfg.verified_role_id,
                );
                await interaction.reply({
                    content: 'Tu étais déjà vérifié pour ce serveur : le rôle a été réattribué.',
                    flags: MessageFlags.Ephemeral,
                });
            } catch (e) {
                await interaction.reply({
                    content: `Erreur rôle : ${e.message || e}. Vérifie que le rôle du bot est **au-dessus** du rôle vérifié.`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }

        const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
        const stateSecret = String(process.env.OAUTH_STATE_SECRET || '').trim();
        if (!publicBaseUrl || !stateSecret) {
            await interaction.reply({
                content:
                    'Le système de vérification n’est pas configuré côté serveur (variables `PUBLIC_BASE_URL` et `OAUTH_STATE_SECRET` manquantes). Préviens un administrateur.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const url = buildVerifyUrl(
            { publicBaseUrl, stateSecret },
            interaction.user.id,
            interaction.guild.id,
        );
        const linkRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setURL(url)
                .setLabel('🔓 Ouvrir la page de vérification'),
        );
        await interaction.reply({
            content:
                'Clique sur le bouton ci-dessous pour ouvrir la page de vérification dans ton navigateur ' +
                '(reste connecté(e) au **même compte Discord**).',
            components: [linkRow],
            flags: MessageFlags.Ephemeral,
        });
    },
};
