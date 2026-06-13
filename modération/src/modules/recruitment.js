const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const CONFIG = require('../config.js');

/**
 * Module de gestion du recrutement des modérateurs
 * Basé sur l'ancienne version du backup
 */
class RecruitmentManager {
    constructor() {
        this.recruitmentStatePath = path.join(__dirname, '../../recruitment_state.json');
        this.recruitmentState = this.loadRecruitmentState();
        
        // Configuration depuis config.js
        this.RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID = CONFIG.RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID;
        this.RECRUITMENT_CHANNEL_ID = CONFIG.RECRUITMENT_CHANNEL_ID;
        this.RECRUITMENT_MESSAGE_ID = CONFIG.RECRUITMENT_MESSAGE_ID || null;
        this.STAFF_CHANNEL_ID = CONFIG.STAFF_CHANNEL_ID;
        
        // Système de bypass pour permettre à certains utilisateurs de postuler sans conditions
        // Map: userId => timestamp d'expiration
        this.bypassList = new Map();
        
        // Nettoyer les bypass expirés toutes les 5 minutes
        setInterval(() => this.cleanupExpiredBypass(), 5 * 60 * 1000);
    }

    /**
     * Ajoute un bypass pour un utilisateur (valide 1 heure)
     * @param {string} userId - L'ID de l'utilisateur
     */
    addBypass(userId) {
        const expiresAt = Date.now() + (60 * 60 * 1000); // 1 heure
        this.bypassList.set(userId, expiresAt);
        console.log(`[BYPASS] Bypass ajouté pour ${userId} jusqu'à ${new Date(expiresAt).toLocaleString()}`);
    }

    /**
     * Vérifie si un utilisateur a un bypass valide
     * @param {string} userId - L'ID de l'utilisateur
     * @returns {boolean} - true si le bypass est valide
     */
    hasValidBypass(userId) {
        if (!this.bypassList.has(userId)) return false;
        
        const expiresAt = this.bypassList.get(userId);
        if (Date.now() >= expiresAt) {
            // Bypass expiré, le supprimer
            this.bypassList.delete(userId);
            console.log(`[BYPASS] Bypass expiré pour ${userId}`);
            return false;
        }
        return true;
    }

    /**
     * Supprime le bypass d'un utilisateur (après utilisation)
     * @param {string} userId - L'ID de l'utilisateur
     */
    removeBypass(userId) {
        if (this.bypassList.has(userId)) {
            this.bypassList.delete(userId);
            console.log(`[BYPASS] Bypass utilisé et supprimé pour ${userId}`);
        }
    }

    /**
     * Nettoie les bypass expirés
     */
    cleanupExpiredBypass() {
        const now = Date.now();
        let cleaned = 0;
        for (const [userId, expiresAt] of this.bypassList.entries()) {
            if (now >= expiresAt) {
                this.bypassList.delete(userId);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`[BYPASS] ${cleaned} bypass expiré(s) nettoyé(s)`);
        }
    }

    /**
     * Charge l'état du recrutement
     */
    loadRecruitmentState() {
        const defaultState = {
            moderateur: { open: false, places: 0 },
            communiquant: { open: false, places: 0 },
            developpeur: { open: false, places: 0 },
            messageId: this.RECRUITMENT_MESSAGE_ID
        };

        if (fs.existsSync(this.recruitmentStatePath)) {
            try {
                const state = JSON.parse(fs.readFileSync(this.recruitmentStatePath, 'utf8'));
                // Migration simple si l'ancien format est détecté
                if (state.open !== undefined) {
                    return defaultState;
                }
                // Assurer que toutes les clés existent
                return { ...defaultState, ...state };
            } catch (e) {
                console.error("Erreur lors du chargement de l'état du recrutement:", e);
                return defaultState;
            }
        }
        return defaultState;
    }

    /**
     * Sauvegarde l'état du recrutement
     */
    saveRecruitmentState() {
        fs.writeFileSync(this.recruitmentStatePath, JSON.stringify(this.recruitmentState, null, 2), 'utf8');
    }

    /**
     * Ouvre le recrutement pour une spécialité
     */
    async openRecruitment(interaction, specialite, places) {
        if (!this.recruitmentState[specialite]) {
            this.recruitmentState[specialite] = { open: false, places: 0 };
        }
        
        this.recruitmentState[specialite].open = true;
        this.recruitmentState[specialite].places = places;
        this.saveRecruitmentState();
        await this.updateRecruitmentMessage(interaction.client);
        
        const successEmbed = new EmbedBuilder()
            .setTitle(`✅ Recrutement ${specialite.charAt(0).toUpperCase() + specialite.slice(1)} Ouvert`)
            .setDescription(`Le recrutement pour **${specialite}** a été ouvert avec succès !\n\n📊 **Places disponibles :** ${places}`)
            .setColor('#00FF00')
            .setTimestamp();
        
        await interaction.reply({
            embeds: [successEmbed],
            ephemeral: true
        });
    }

    /**
     * Ferme le recrutement pour une spécialité ou tout
     */
    async closeRecruitment(interaction, specialite) {
        if (specialite === 'tout') {
            ['moderateur', 'communiquant', 'developpeur'].forEach(spec => {
                if (this.recruitmentState[spec]) {
                    this.recruitmentState[spec].open = false;
                    this.recruitmentState[spec].places = 0;
                }
            });
        } else {
            if (this.recruitmentState[specialite]) {
                this.recruitmentState[specialite].open = false;
                this.recruitmentState[specialite].places = 0;
            }
        }

        this.saveRecruitmentState();
        await this.updateRecruitmentMessage(interaction.client);
        
        const closeEmbed = new EmbedBuilder()
            .setTitle('🔒 Recrutement Fermé')
            .setDescription(`Le recrutement pour **${specialite}** a été fermé avec succès.`)
            .setColor('#FF0000')
            .setTimestamp();
        
        await interaction.reply({
            embeds: [closeEmbed],
            ephemeral: true
        });
    }

    /**
     * Met à jour le message de recrutement
     */
    async updateRecruitmentMessage(client) {
        const recruitmentChannel = await client.channels.fetch(this.RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
        if (!recruitmentChannel) {
            console.error("Le salon de recrutement est introuvable. Impossible de mettre à jour le message.");
            return;
        }

        let messageToEdit;
        try {
            if (!this.recruitmentState.messageId) {
                // Essayer de trouver le dernier message du bot si l'ID est manquant
                const messages = await recruitmentChannel.messages.fetch({ limit: 10 });
                const lastBotMessage = messages.find(m => m.author.id === client.user.id);
                if (lastBotMessage) {
                    this.recruitmentState.messageId = lastBotMessage.id;
                    messageToEdit = lastBotMessage;
                } else {
                    throw new Error("ID du message de recrutement non trouvé.");
                }
            } else {
                messageToEdit = await recruitmentChannel.messages.fetch(this.recruitmentState.messageId);
            }
        } catch (error) {
            console.error("Message de recrutement non trouvé, création d'un nouveau message.");
            const newRecruitmentMessage = await recruitmentChannel.send({
                content: '# Recrutement Staff',
                embeds: [],
                components: []
            });
            this.recruitmentState.messageId = newRecruitmentMessage.id;
            this.saveRecruitmentState();
            messageToEdit = newRecruitmentMessage;
        }

        const embed = new EmbedBuilder()
            .setTitle('🎯 Recrutement Staff')
            .setDescription(`**Nous recherchons de nouveaux talents pour rejoindre l'équipe !** 🌟\n\nConsultez les postes ouverts ci-dessous et postulez si vous pensez avoir le profil !\n\n� **Avant de postuler :**\n• Vous devez être sur le serveur depuis au moins **1 mois**.\n• Vous avez **2 chances** de candidature (réinitialisation tous les 6 mois).\n• Soyez sérieux et honnête dans vos réponses.`)
            .setColor('#2B2D31')
            .setTimestamp();

        const row = new ActionRowBuilder();
        let hasOpenRecruitment = false;

        // Modérateur
        if (this.recruitmentState.moderateur && this.recruitmentState.moderateur.open && this.recruitmentState.moderateur.places > 0) {
            embed.addFields({
                name: 'Modérateur',
                value: `Ouvert (${this.recruitmentState.moderateur.places} places)\nSécurité et ambiance du serveur.`,
                inline: true
            });
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('apply_moderateur')
                    .setLabel('Postuler Modérateur')
                    .setStyle(ButtonStyle.Primary)
            );
            hasOpenRecruitment = true;
        } else {
            embed.addFields({ name: 'Modérateur', value: 'Fermé', inline: true });
        }

        // Communiquant
        if (this.recruitmentState.communiquant && this.recruitmentState.communiquant.open && this.recruitmentState.communiquant.places > 0) {
            embed.addFields({
                name: 'Communiquant',
                value: `Ouvert (${this.recruitmentState.communiquant.places} places)\nAnimation et communication du serveur.`,
                inline: true
            });
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('apply_communiquant')
                    .setLabel('Postuler Communiquant')
                    .setStyle(ButtonStyle.Success)
            );
            hasOpenRecruitment = true;
        } else {
            embed.addFields({ name: 'Communiquant', value: 'Fermé', inline: true });
        }

        // Développeur
        if (this.recruitmentState.developpeur && this.recruitmentState.developpeur.open && this.recruitmentState.developpeur.places > 0) {
            embed.addFields({
                name: 'Développeur',
                value: `Ouvert (${this.recruitmentState.developpeur.places} places)\nBots et outils du serveur.`,
                inline: true
            });
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('apply_developpeur')
                    .setLabel('Postuler Développeur')
                    .setStyle(ButtonStyle.Secondary)
            );
            hasOpenRecruitment = true;
        } else {
            embed.addFields({ name: 'Développeur', value: 'Fermé', inline: true });
        }

        if (!hasOpenRecruitment) {
            embed.setColor('#FF0000');
            embed.setDescription('Recrutement fermé pour tous les postes.');
        }

        const components = hasOpenRecruitment ? [row] : [];
        await messageToEdit.edit({ content: '', embeds: [embed], components: components });
    }

    /**
     * Réduit le nombre de places disponibles pour une spécialité
     */
    decrementPlaces(specialite) {
        if (this.recruitmentState[specialite] && this.recruitmentState[specialite].places > 0) {
            this.recruitmentState[specialite].places--;
            this.saveRecruitmentState();
            return true;
        }
        return false;
    }

    /**
     * Vérifie si le recrutement est ouvert pour une spécialité
     */
    isOpen(specialite) {
        return this.recruitmentState[specialite] && this.recruitmentState[specialite].open;
    }

    /**
     * Récupère le nombre de places disponibles pour une spécialité
     */
    getAvailablePlaces(specialite) {
        // Si aucune spécialité n'est fournie, retourner le total de toutes les spécialités
        if (!specialite) {
            let total = 0;
            ['moderateur', 'communiquant', 'developpeur'].forEach(spec => {
                if (this.recruitmentState[spec] && this.recruitmentState[spec].open) {
                    total += this.recruitmentState[spec].places || 0;
                }
            });
            return total;
        }
        return this.recruitmentState[specialite] ? this.recruitmentState[specialite].places : 0;
    }
}

module.exports = RecruitmentManager;
