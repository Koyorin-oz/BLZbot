const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { onMemberJoined } = require('../utils/member-stats-voice');
const { runWithEconomyGuild } = require('../utils/economy-scope');
const { resolveTutorialChannelId } = require('../utils/blz-guild-channels');

let _warnedTutorialChannelInaccessible = false;
const { initializeTutorial } = require('../utils/tutorial-handler');
const { getGuildOfUser } = require('../utils/db-guilds');
const { updateGuildChannelPermissions } = require('../utils/guild/guild-upgrades');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member, client) {
        onMemberJoined(member.guild, member).catch(() => {});

        return runWithEconomyGuild(member.guild.id, async () => {
        try {
            logger.info(`[TUTORIAL] Nouveau membre détecté: ${member.user.username} (${member.id})`);

            const tutorialChannelId = resolveTutorialChannelId(member.guild.id);

            if (!tutorialChannelId) {
                logger.warn('[TUTORIAL] Aucun salon tutoriel configuré pour ce serveur (.env TUTORIAL_CHANNEL ou test).');
                return;
            }

            logger.debug(`[TUTORIAL] Récupération du canal ${tutorialChannelId}...`);

            // Récupérer le canal de tutoriel
            const tutorialChannel = await member.guild.channels.fetch(tutorialChannelId).catch((err) => {
                if (!_warnedTutorialChannelInaccessible) {
                    _warnedTutorialChannelInaccessible = true;
                    logger.warn(
                        `[TUTORIAL] Canal ${tutorialChannelId} inaccessible (${err.code || err.message}) — permissions bot ou mauvais salon pour ce serveur.`
                    );
                }
                return null;
            });

            if (!tutorialChannel) {
                return;
            }

            logger.debug(`[TUTORIAL] Création du fil privé...`);

            // Créer un fil privé pour le nouveau membre
            const thread = await tutorialChannel.threads.create({
                name: `Tutoriel - ${member.user.username}`,
                autoArchiveDuration: 1440, // 24 heures
                reason: `Tutoriel pour ${member.user.username}`,
                type: 12, // GUILD_PRIVATE_THREAD
            }).catch((err) => {
                logger.error(`[TUTORIAL] Erreur création fil:`, err);
                throw err;
            });

            logger.debug(`[TUTORIAL] Ajout du membre au fil...`);

            // Ajouter le membre au fil
            await thread.members.add(member.id).catch((err) => {
                logger.error(`[TUTORIAL] Erreur ajout membre au fil:`, err);
                throw err;
            });

            logger.info(`[TUTORIAL] Fil privé créé pour ${member.user.username} (${member.id})`);

            // Initialiser le tutoriel
            logger.debug(`[TUTORIAL] Initialisation du tutoriel...`);
            await initializeTutorial(member, thread);
            logger.debug(`[TUTORIAL] Tutoriel initialisé avec succès`);

            // Restaurer les permissions de guilde si nécessaire
            const guild = getGuildOfUser(member.id);
            if (guild && guild.channel_id) {
                logger.info(`[GUILD] Restauration des permissions pour ${member.user.username} dans le salon de ${guild.name}`);
                await updateGuildChannelPermissions(client, guild, member.id, 'add');
            }

        } catch (error) {
            logger.error('[TUTORIAL] ERREUR CRITIQUE lors de la création du tutoriel:', error);
            logger.error('[TUTORIAL] Stack trace:', error.stack);
        }
        });
    }
};
