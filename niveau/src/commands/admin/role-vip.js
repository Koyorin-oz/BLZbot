const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { handleCommandError } = require('../../utils/error-handler');
const db = require('../../database/database');
const roleConfig = require('../../config/role.config.json');
const logger = require('../../utils/logger');

const VIP_ROLE_ID = roleConfig.specialRoles?.vip?.id || roleConfig.roleIds?.vip;
const VIP_ALIASES = roleConfig.roleIds?.vipAliases || [];
const ALL_VIP_IDS = [VIP_ROLE_ID, ...VIP_ALIASES].filter(Boolean);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role-vip')
        .setDescription('Créer ou modifier ton rôle personnalisé VIP.'),

    async execute(interaction) {
        try {
            const member = interaction.member;

            // Vérifier que l'utilisateur a le rôle VIP pour accéder à la commande
            const isVip = ALL_VIP_IDS.some(id => member.roles.cache.has(id));
            if (!isVip) {
                return interaction.reply({
                    content: '❌ Tu dois avoir le rôle **VIP** pour utiliser cette commande.',
                    ephemeral: true
                });
            }

            // Récupérer les données existantes pour pré-remplir le modal
            const existing = db.prepare('SELECT * FROM vip_custom_roles WHERE user_id = ?').get(member.id);

            // Créer le modal avec raw payload pour supporter le file upload
            // Discord.js v14 ne supporte pas nativement les file uploads dans les modals
            // donc on utilise un payload brut conforme à l'API Discord
            const modalPayload = {
                type: 9, // MODAL
                data: {
                    custom_id: 'vip_role_modal',
                    title: '👑 Rôle VIP Personnalisé',
                    components: [
                        // Nom du rôle
                        {
                            type: 1, // ActionRow
                            components: [
                                {
                                    type: 4, // TextInput
                                    custom_id: 'vip_role_name',
                                    label: 'Nom du rôle',
                                    style: 1, // Short
                                    placeholder: 'Ex: ✨ Mon Rôle Cool',
                                    max_length: 100,
                                    required: true,
                                    value: existing?.role_name || undefined
                                }
                            ]
                        },
                        // Couleur
                        {
                            type: 1,
                            components: [
                                {
                                    type: 4,
                                    custom_id: 'vip_role_color',
                                    label: 'Couleur (code hex)',
                                    style: 1,
                                    placeholder: 'Ex: #FF5733 ou FF5733',
                                    max_length: 7,
                                    required: true,
                                    value: existing?.role_color || undefined
                                }
                            ]
                        },
                        // File Upload (Label + FileUpload)
                        {
                            type: 18, // Label
                            label: 'Icône du rôle (image)',
                            description: 'Tu peux uploader une image (PNG/JPG) pour l\'icône de ton rôle',
                            component: {
                                type: 19, // FileUpload
                                custom_id: 'vip_role_icon_upload',
                                min_values: 0,
                                max_values: 1,
                                required: false
                            }
                        },
                        // Icône texte (fallback)
                        {
                            type: 1,
                            components: [
                                {
                                    type: 4,
                                    custom_id: 'vip_role_icon',
                                    label: 'Icône (emoji ou URL)',
                                    style: 1,
                                    placeholder: 'Ex: 🔥 ou https://i.imgur.com/abc.png',
                                    required: false,
                                    value: existing?.role_icon || undefined
                                }
                            ]
                        }
                    ]
                }
            };

            // Envoyer la réponse avec le modal en utilisant l'API REST
            await interaction.client.rest.post(
                `/interactions/${interaction.id}/${interaction.token}/callback`,
                {
                    body: modalPayload
                }
            );
        } catch (error) {
            handleCommandError(interaction, error, 'role-vip');
        }
    }
};
