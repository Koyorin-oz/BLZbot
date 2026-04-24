const { SlashCommandBuilder, PermissionFlagsBits, Colors } = require('discord.js');
const roleConfig = require('../../config/role.config.json');

const RANKS = roleConfig.rankRoles.creation;

function resolveColor(color) {
    if (!color) return undefined;
    if (typeof color === 'string' && Colors[color]) return Colors[color];
    return color;
}

/** Même tri que `discord.js` (rawPosition, puis id) — indice 0 = @everyone, dernier = rôle le plus haut. */
function sortRolesByGuildOrder(guild) {
    return Array.from(guild.roles.cache.values()).sort(
        (a, b) => a.rawPosition - b.rawPosition || Number(BigInt(a.id) - BigInt(b.id)),
    );
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('creer-roles')
        .setDescription('Crée tous les rôles de rangs du bot.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const rolesToCreate = [...RANKS].reverse(); // Copie et inverse pour créer du plus haut au plus bas

        try {
            // 1. Trouver le rôle le plus peuplé
            await guild.members.fetch(); // S'assurer que tous les membres sont dans le cache
            const roles = await guild.roles.fetch();

            let mostPopulatedRole = null;
            let maxMembers = 0;

            roles.forEach(role => {
                if (role.name === '@everyone') return;
                if (role.members.size > maxMembers) {
                    maxMembers = role.members.size;
                    mostPopulatedRole = role;
                }
            });

            // 2. Créer les rôles
            const createdRoles = [];
            for (const rank of rolesToCreate) {
                const existingRole = guild.roles.cache.find(r => r.name === rank.name);
                if (!existingRole) {
                    const c = resolveColor(rank.color);
                    const newRole = await guild.roles.create({
                        name: rank.name,
                        ...(c != null ? { colors: { primaryColor: c } } : {}),
                        permissions: [],
                    });
                    createdRoles.push(newRole);
                    console.log(`Rôle "${rank.name}" créé.`);
                }
            }

            // 3. Positionner : `Role#setPosition` attend l’**indice** dans la liste triée (comme d.js), pas le champ `position` API.
            // + re-fetch + recalcul à chaque itération : un même move réécrit tout l’ordre des rôles.
            const orderedRolesToPosition = createdRoles.reverse();
            if (orderedRolesToPosition.length > 0) {
                let anyClamped = false;
                let anyFailed = false;
                for (let i = 0; i < orderedRolesToPosition.length; i++) {
                    await guild.roles.fetch();
                    await guild.members.fetch(guild.client.user.id);
                    const m = guild.members.me;
                    if (!m) {
                        anyFailed = true;
                        break;
                    }
                    const role = orderedRolesToPosition[i];
                    const sorted = sortRolesByGuildOrder(guild);
                    const bIdx = sorted.findIndex((r) => r.id === m.roles.highest.id);
                    if (bIdx < 0) {
                        anyFailed = true;
                        break;
                    }
                    const maxSlot = bIdx - 1;
                    if (maxSlot < 1) {
                        await interaction.followUp({
                            content:
                                'Rôles créés, mais le rôle **du bot** est trop bas : place-le **tout en haut** (sous le staff), permissions **Gérer les rôles**, puis relance pour terminer le placement (ou place les rôles à la main).',
                            ephemeral: true,
                        });
                        return;
                    }
                    const mpIdx = mostPopulatedRole
                        ? sorted.findIndex((r) => r.id === mostPopulatedRole.id)
                        : 1;
                    if (mpIdx < 0) {
                        anyFailed = true;
                        break;
                    }
                    let targetIdx = mpIdx + 1 + i;
                    if (targetIdx < 1) targetIdx = 1;
                    if (targetIdx > maxSlot) {
                        anyClamped = true;
                        targetIdx = maxSlot;
                    }
                    if (targetIdx >= sorted.length) {
                        anyClamped = true;
                        targetIdx = Math.min(maxSlot, sorted.length - 1);
                    }
                    try {
                        await role.setPosition(targetIdx);
                    } catch (e) {
                        if (e?.code === 50013) {
                            anyFailed = true;
                            break;
                        }
                        throw e;
                    }
                }

                let msg = anyFailed
                    ? 'Rôles créés, mais le **repositionnement automatique** a échoué (Discord 50013). Donne **Gérer le serveur** (ou *Administrateur*), mets le rôle du **bot** au-dessus des rôles de **rangs**, et réessaie (ou place les rôles à la main).'
                    : 'Tous les rôles de rangs ont été créés et positionnés avec succès !';
                if (anyClamped && !anyFailed) {
                    msg +=
                        ' *(Plafond appliqué : l’ordre tient compte de la place du rôle du bot — complète à la main si besoin.)*';
                }
                await interaction.followUp({ content: msg, ephemeral: true });
            } else {
                await interaction.followUp({
                    content: 'Aucun nouveau rôle à créer (tout existait déjà).',
                    ephemeral: true,
                });
            }

        } catch (error) {
            console.error('Erreur lors de la création des rôles :', error);
            await interaction.followUp('Une erreur est survenue. Vérifiez les permissions du bot et réessayez.');
        }
    },
};
