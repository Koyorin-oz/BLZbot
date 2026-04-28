/**
 * /mute — Time out temporaire d'un membre + audit + compteur TO REBORN.
 *
 * Remplace l'ancien `/passeport timeout`. Le TO est :
 * - appliqué via `member.timeout()` (best-effort, nécessite la permission "Modérer les membres" pour le bot),
 * - logé dans la table REBORN `staff_timeouts` (compteur visible sur le passeport),
 * - logé dans `staff_audit` (action `timeout`).
 *
 * Les sanctions définitives (ban, kick) restent gérées par le bot modération.
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const { isOwner } = require('../lib/owners');
const users = require('../services/users');

function canModerate(interaction) {
  const has = interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers);
  const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  return Boolean(has || admin) || isOwner(interaction.user.id);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Time out temporaire d’un membre (REBORN — logé sur son passeport).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName('membre').setDescription('Cible').setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName('minutes')
        .setDescription('Durée du mute en minutes (1 → 10080 = 7 jours)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10080),
    )
    .addStringOption((o) =>
      o.setName('raison').setDescription('Raison (≤ 500 car.)').setRequired(false),
    ),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });
    if (!canModerate(interaction)) {
      return interaction.reply({
        content: '❌ Permission **Modérer les membres** requise.',
      });
    }

    const target = interaction.options.getUser('membre', true);
    if (target.bot) {
      return interaction.reply({ content: '❌ Impossible sur un bot.' });
    }
    if (target.id === interaction.user.id) {
      return interaction.reply({ content: '❌ Tu ne peux pas te mute toi-même.' });
    }

    const mins = interaction.options.getInteger('minutes', true);
    const reason = (interaction.options.getString('raison') || '').slice(0, 500);

    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);
    if (!member) {
      return interaction.reply({
        content: '❌ Membre introuvable sur ce serveur.',
      });
    }

    if (
      member.roles?.highest?.position >=
      interaction.member.roles?.highest?.position
    ) {
      if (!isOwner(interaction.user.id)) {
        return interaction.reply({
          content:
            '❌ Tu ne peux pas mute un membre dont le rôle est supérieur ou égal au tien.',
        });
      }
    }

    if (
      interaction.guild.members.me &&
      member.roles?.highest?.position >=
        interaction.guild.members.me.roles?.highest?.position
    ) {
      return interaction.reply({
        content: '❌ Je ne peux pas mute ce membre (rôle au-dessus du mien).',
      });
    }

    users.getOrCreate(target.id, target.username);

    const audit = require('../services/staffAudit');
    const r = await audit.addTimeout({
      hubDiscordId: hub,
      targetId: target.id,
      modId: interaction.user.id,
      durationMin: mins,
      reason,
      member,
    });

    const minsTxt =
      mins >= 60
        ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}min` : ''}`
        : `${mins} min`;

    if (r.applied) {
      try {
        await target.send(
          `🔇 Tu as été **mute** sur **${interaction.guild.name}** pendant **${minsTxt}**${reason ? ` — *${reason}*` : ''}.`,
        );
      } catch {
        /* DM fermé : ignore */
      }
      const e = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('🔇 Mute appliqué')
        .setDescription(
          `${target} a été **mute** pendant **${minsTxt}**${reason ? `\n*Raison :* ${reason}` : ''}\n\n*Logé sur le passeport REBORN (compteur TO).*`,
        );
      return interaction.reply({ embeds: [e] });
    }

    return interaction.reply({
      content: `⚠️ Mute **logé** sur le passeport mais **non appliqué** (le bot n'a pas la permission de timeout ?).\nErreur : \`${r.error || '—'}\``,
    });
  },
};
