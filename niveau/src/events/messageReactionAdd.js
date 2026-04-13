const { Events } = require('discord.js');
const { getOrCreateUser, grantResources, updateUserActivityTimestamp } = require('../utils/db-users');
const { checkQuestProgress } = require('../utils/quests');
const { grantRubanForAction } = require('../utils/ruban-rewards');
const { handlePuissance4Reaction } = require('../utils/minigame-handler');
const { runWithEconomyGuild } = require('../utils/economy-scope');
const logger = require('../utils/logger');

// Cooldown (en mémoire) — par serveur pour ne pas mélanger test / prod
const reactionCooldown = new Set();

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        if (user.bot) {
            return;
        }

        let message = reaction.message;
        if (reaction.partial) {
            try {
                message = await reaction.fetch();
            } catch {
                return;
            }
        }
        if (!message.guild) {
            return;
        }

        const guildId = message.guild.id;
        const cooldownKey = `${guildId}:${user.id}`;

        return runWithEconomyGuild(guildId, async () => {
            const p4Emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
            if (p4Emojis.includes(reaction.emoji.name)) {
                try {
                    await handlePuissance4Reaction(reaction, user, reaction.client);
                } catch (error) {
                    logger.error(`Erreur lors du traitement de la réaction Puissance 4:`, error);
                }
                return;
            }

            if (reactionCooldown.has(cooldownKey)) {
                return;
            }

            try {
                getOrCreateUser(user.id, user.username);
                updateUserActivityTimestamp(user.id);
                grantResources(reaction.client, user.id, { stars: 1, source: 'reaction' });

                grantRubanForAction(user.id, 'reaction');

                checkQuestProgress(reaction.client, 'REACTION_ADD', user);

                reactionCooldown.add(cooldownKey);
                setTimeout(() => {
                    reactionCooldown.delete(cooldownKey);
                }, 20000);
            } catch (error) {
                logger.error(`Erreur lors de l'attribution de Starss pour une réaction par ${user.username}:`, error);
            }
        });
    },
};
