const path = require('node:path');
const { Collection, EmbedBuilder } = require('discord.js');
const CONFIG = require('../config.js');
const { isTestBotProfile } = require(path.join(__dirname, '..', '..', '..', 'blzbot-env.js'));

/**
 * Module de gestion du snipe (messages supprimés et édités)
 */
class SnipeManager {
    constructor() {
        this.deletedMessages = new Collection();
        this.editedMessages = new Collection();

        // Configuration depuis config.js
        this.excludedCategoryId = CONFIG.SNIPE_CONFIG.excludedCategoryId;
        this.requiredRoleId = CONFIG.STAFF_ROLE_ID;
        this.specialUserId = CONFIG.SPECIAL_USER_ID;
        this.maxHistorySize = CONFIG.SNIPE_CONFIG.maxHistorySize;
    }

    /**
     * Échappe les mentions dans un message
     */
    escapeMentions(str) {
        return str.replace(/@([^<>@ ]*)/g, '@.$1');
    }

    /**
     * Enregistre un message supprimé
     */
    onMessageDelete(message) {
        if (!message.content && message.attachments.size === 0) return;

        const chanId = message.channel.id;
        const arr = this.deletedMessages.get(chanId) || [];

        arr.push(message);
        if (arr.length > this.maxHistorySize) {
            arr.shift();
        }
        this.deletedMessages.set(chanId, arr);
    }

    /**
     * Enregistre un message édité
     */
    onMessageUpdate(oldMsg, newMsg) {
        if (oldMsg.content === newMsg.content) return;

        this.editedMessages.set(oldMsg.channel.id, {
            authorTag: oldMsg.author.tag,
            authorId: oldMsg.author.id,
            authorAvatar: oldMsg.author.avatarURL(),
            before: oldMsg.content || '[aucun contenu]',
            after: newMsg.content
        });
    }

    /**
     * Vérifie si un utilisateur a la permission d'utiliser le snipe
     */
    hasPermission(message) {
        const hasRole = message.member.roles.cache.has(this.requiredRoleId);
        const isSpecial = message.author.id === this.specialUserId;
        return hasRole || isSpecial;
    }

    /**
     * Vérifie si le snipe est autorisé dans le salon
     */
    isAllowedInChannel(message) {
        return message.channel.parentId !== this.excludedCategoryId;
    }

    /**
     * Divise un texte en plusieurs parties si trop long
     */
    splitText(text, maxLength = 4096) {
        if (!text) return ['[Aucun contenu]'];
        const escaped = this.escapeMentions(text);
        if (escaped.length <= maxLength) return [escaped];

        const parts = [];
        let currentPart = '';
        const lines = escaped.split('\n');

        for (const line of lines) {
            if ((currentPart + line + '\n').length > maxLength) {
                if (currentPart) parts.push(currentPart);
                if (line.length > maxLength) {
                    // Si une seule ligne est trop longue, la découper
                    for (let i = 0; i < line.length; i += maxLength) {
                        parts.push(line.substring(i, i + maxLength));
                    }
                    currentPart = '';
                } else {
                    currentPart = line + '\n';
                }
            } else {
                currentPart += line + '\n';
            }
        }
        if (currentPart) parts.push(currentPart);

        return parts;
    }

    /**
     * Traite la commande !snipe
     */
    async handleSnipeCommand(message, arg) {
        if (!this.hasPermission(message)) {
            return message.reply("Vous n'avez pas la permission d'utiliser cette commande.");
        }

        if (!this.isAllowedInChannel(message)) {
            return message.reply("Cette commande n'est pas autorisée dans ce salon.");
        }

        const requested = parseInt(arg);
        const count = isNaN(requested) ? 1 : Math.min(Math.max(requested, 1), this.maxHistorySize);

        const history = this.deletedMessages.get(message.channel.id) || [];
        if (history.length === 0) {
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🔍 Aucun message supprimé')
                .setDescription('Aucun message supprimé récemment dans ce salon.')
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }

        const toShow = history.slice(-count);

        // Si un seul message, affichage détaillé
        if (toShow.length === 1) {
            const msg = toShow[0];
            const allEmbeds = [];

            // Construire le contenu complet avec pièces jointes
            let fullContent = this.escapeMentions(msg.content || '[Pièce jointe]');

            if (msg.attachments.size > 0) {
                const attachmentsList = msg.attachments.map(att => `[${att.name}](${att.url})`).join('\n');
                fullContent += `\n\n📎 **Pièces jointes:**\n${attachmentsList}`;
            }

            // Diviser seulement si nécessaire (> 4096 caractères)
            const contentParts = this.splitText(fullContent, 4096);

            // Premier embed
            const firstEmbed = new EmbedBuilder()
                .setColor('#FF6B6B')
                .setAuthor({
                    name: msg.author.tag,
                    iconURL: msg.author.avatarURL()
                })
                .setTitle('🗑️ Message supprimé')
                .setDescription(contentParts[0])
                .setTimestamp(msg.createdAt)
                .setFooter({
                    text: contentParts.length > 1
                        ? `ID: ${msg.author.id} | Partie 1/${contentParts.length}`
                        : `ID: ${msg.author.id}`
                });

            // Afficher la première image si disponible
            // Récupérer toutes les images
            const images = msg.attachments.filter(att =>
                att.contentType && att.contentType.startsWith('image/')
            ).map(att => att.url);

            if (images.length > 0) {
                firstEmbed.setImage(images[0]);
            }

            allEmbeds.push(firstEmbed);

            // Ajouter les images supplémentaires (max 3 de plus pour éviter le spam)
            for (let i = 1; i < images.length && i < 4; i++) {
                const imgEmbed = new EmbedBuilder()
                    .setURL('https://discord.com') // URL requise pour que l'embed soit valide parfois ? Non mais bon pratique.
                    .setImage(images[i])
                    .setColor('#FF6B6B');
                allEmbeds.push(imgEmbed);
            }

            // Embeds supplémentaires seulement si le contenu est trop long
            for (let i = 1; i < contentParts.length; i++) {
                allEmbeds.push(new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setDescription(contentParts[i])
                    .setFooter({ text: `Partie ${i + 1}/${contentParts.length}` })
                );
            }

            // Envoyer (1 embed par message pour éviter dépassement)
            for (let i = 0; i < allEmbeds.length; i++) {
                if (i === 0) {
                    await message.reply({ embeds: [allEmbeds[i]] });
                } else {
                    await message.channel.send({ embeds: [allEmbeds[i]] });
                }
            }
            return;
        }

        // Plusieurs messages : accumuler dans la description
        const allEmbeds = [];
        let currentDescription = '';
        const MAX_DESCRIPTION = 3800; // Limite conservative pour éviter dépassement (Discord: 4096)

        for (let i = 0; i < toShow.length; i++) {
            const msg = toShow[i];
            let content = this.escapeMentions(msg.content || '[Pièce jointe]');

            if (msg.attachments.size > 0) {
                const attachmentsList = msg.attachments.map(att => `[${att.name}](${att.url})`).join(', ');
                content += `\n📎 ${attachmentsList}`;
            }

            // Format du message dans la liste
            const messageBlock = `**${i + 1}. ${msg.author.tag}** - <t:${Math.floor(msg.createdAt.getTime() / 1000)}:R>\n${content}\n\n`;

            // Calculer le titre actuel
            const currentTitle = allEmbeds.length === 0
                ? `🗑️ ${toShow.length} derniers messages supprimés`
                : `🗑️ ${toShow.length} derniers messages supprimés (suite ${allEmbeds.length + 1})`;

            // Calculer la taille totale de l'embed (titre + description + overhead)
            const totalEmbedSize = currentTitle.length + (currentDescription + messageBlock).length;

            // Limite stricte: 5500 caractères pour laisser de la place aux métadonnées Discord
            if (currentDescription.length + messageBlock.length > MAX_DESCRIPTION || totalEmbedSize > 5500) {
                // Sauvegarder l'embed actuel
                if (currentDescription.length > 0) {
                    const saveTitle = allEmbeds.length === 0
                        ? `🗑️ ${toShow.length} derniers messages supprimés`
                        : `🗑️ ${toShow.length} derniers messages supprimés (suite ${allEmbeds.length})`;

                    allEmbeds.push(new EmbedBuilder()
                        .setColor('#FF6B6B')
                        .setTitle(saveTitle)
                        .setDescription(currentDescription.trim())
                        .setTimestamp()
                    );
                }
                currentDescription = messageBlock;
            } else {
                currentDescription += messageBlock;
            }
        }

        // Ajouter le dernier embed
        if (currentDescription.length > 0) {
            const finalTitle = allEmbeds.length === 0
                ? `🗑️ ${toShow.length} derniers messages supprimés`
                : `🗑️ ${toShow.length} derniers messages supprimés (suite ${allEmbeds.length + 1})`;

            allEmbeds.push(new EmbedBuilder()
                .setColor('#FF6B6B')
                .setTitle(finalTitle)
                .setDescription(currentDescription.trim())
                .setTimestamp()
            );
        }

        // Envoyer les embeds (1 par message pour éviter dépassement)
        for (let i = 0; i < allEmbeds.length; i++) {
            if (i === 0) {
                await message.reply({ embeds: [allEmbeds[i]] });
            } else {
                await message.channel.send({ embeds: [allEmbeds[i]] });
            }
        }
    }

    /**
     * Traite la commande !esnipe
     */
    async handleEsnipeCommand(message) {
        if (!this.hasPermission(message)) {
            return message.reply("Vous n'avez pas la permission d'utiliser cette commande.");
        }

        if (!this.isAllowedInChannel(message)) {
            return message.reply("Cette commande n'est pas autorisée dans ce salon.");
        }

        const data = this.editedMessages.get(message.channel.id);
        if (!data) {
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🔍 Aucune édition récente')
                .setDescription('Aucune modification de message récente dans ce salon.')
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }

        const beforeParts = this.splitText(data.before, 1024);
        const afterParts = this.splitText(data.after, 1024);
        const embeds = [];

        // Premier embed avec l'auteur
        const firstEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setAuthor({
                name: data.authorTag,
                iconURL: data.authorAvatar
            })
            .setTitle('✏️ Message édité')
            .setTimestamp()
            .setFooter({ text: `ID: ${data.authorId} | Partie 1/${beforeParts.length + afterParts.length}` });

        // Ajouter la première partie "Avant"
        firstEmbed.addFields({
            name: '📝 Avant' + (beforeParts.length > 1 ? ' (1/' + beforeParts.length + ')' : ''),
            value: beforeParts[0],
            inline: false
        });

        embeds.push(firstEmbed);

        // Ajouter les parties supplémentaires "Avant"
        for (let i = 1; i < beforeParts.length; i++) {
            embeds.push(new EmbedBuilder()
                .setColor('#FFA500')
                .addFields({
                    name: `📝 Avant (${i + 1}/${beforeParts.length})`,
                    value: beforeParts[i],
                    inline: false
                })
                .setFooter({ text: `Partie ${embeds.length + 1}/${beforeParts.length + afterParts.length}` })
            );
        }

        // Ajouter les parties "Après"
        afterParts.forEach((part, i) => {
            embeds.push(new EmbedBuilder()
                .setColor('#FFA500')
                .addFields({
                    name: '✅ Après' + (afterParts.length > 1 ? ` (${i + 1}/${afterParts.length})` : ''),
                    value: part,
                    inline: false
                })
                .setFooter({ text: `Partie ${embeds.length + 1}/${beforeParts.length + afterParts.length}` })
            );
        });

        // Envoyer les embeds
        if (embeds.length <= 10) {
            return message.reply({ embeds });
        } else {
            for (let i = 0; i < embeds.length; i += 10) {
                const batch = embeds.slice(i, i + 10);
                if (i === 0) {
                    await message.reply({ embeds: batch });
                } else {
                    await message.channel.send({ embeds: batch });
                }
            }
        }
    }
}

module.exports = SnipeManager;
