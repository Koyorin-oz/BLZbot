const { Events } = require('discord.js');
const { usersInVoice } = require('../utils/global-state');
const { resetVoiceQuestsProgress } = require('../utils/quests');
const { voiceTrackingKey, runWithEconomyGuild } = require('../utils/economy-scope');
const logger = require('../utils/logger');
const { handleLobbyJoin, deleteIfOwnerEmpty } = require('../utils/private-voice-rooms');

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState, client) {
        await handleLobbyJoin(client, oldState, newState).catch((e) =>
            logger.error('[PRIVATE_ROOM] handleLobbyJoin:', e?.message || e)
        );

        if (oldState.channelId) {
            const ch =
                oldState.channel ||
                (await oldState.guild.channels.fetch(oldState.channelId).catch(() => null));
            if (ch?.isVoiceBased?.()) {
                await deleteIfOwnerEmpty(client, ch).catch((e) =>
                    logger.debug('[PRIVATE_ROOM] deleteIfOwnerEmpty:', e?.message || e)
                );
            }
        }

        const member = newState.member;

        if (member?.user.bot) {
            return; // Ignorer les bots pour quêtes / récompenses vocales
        }

        const userId = newState.id;
        const guildId = newState.guild.id;
        const vKey = voiceTrackingKey(guildId, userId);

        // Un utilisateur est éligible s'il est dans un salon et n'est pas mute/sourd PAR LE SERVEUR
        // (selfMute et selfDeaf ne comptent pas, c'est un choix personnel)
        const isEligible = newState.channelId && !newState.serverMute && !newState.serverDeaf;
        const wasInSet = usersInVoice.has(vKey);

        logger.debug(`VoiceStateUpdate: ${member?.user?.username} | channel: ${newState.channelId} | serverMute: ${newState.serverMute} | serverDeaf: ${newState.serverDeaf} | eligible: ${isEligible} | wasInSet: ${wasInSet}`);

        if (isEligible) {
            if (!wasInSet) {
                logger.info(`${member.user.username} est maintenant éligible aux récompenses vocales.`);
                usersInVoice.add(vKey);
            }
        } else {
            if (wasInSet) {
                logger.info(`${member.user.username} n'est plus éligible aux récompenses vocales (déconnecté ou mute/sourd serveur).`);
                usersInVoice.delete(vKey);
                runWithEconomyGuild(guildId, () => resetVoiceQuestsProgress(userId));
            }
        }

    },
};
