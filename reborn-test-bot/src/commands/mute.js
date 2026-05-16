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
const { parseMuteDuration } = require('../lib/parseMuteDuration');

function canModerate(interaction) {
  const has = interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers);
  const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  return Boolean(has || admin) || isOwner(interaction.user.id);
}

function humanizeMinutes(mins) {
  if (mins >= 1440) {
    const j = Math.floor(mins / 1440);
    const rest = mins % 1440;
    const h = Math.floor(rest / 60);
    const m = rest % 60;
    let s = `${j} j`;
    if (h) s += ` ${h} h`;
    if (m) s += ` ${m} min`;
    return s;
  }
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${mins} min`;
}

/** MP à la cible : pas d’identité du modérateur, uniquement la sanction. */
function buildSanctionDmEmbed({ guildName, minsTxt, durSaisie, reason }) {
  const e = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('Sanction — mute (time-out)')
    .setDescription(
      `Tu as reçu un **mute** sur le serveur **${guildName}**.`,
    )
    .addFields(
      { name: 'Durée', value: minsTxt, inline: true },
      { name: 'Saisie', value: `\`${durSaisie}\``, inline: true },
      {
        name: 'Motif',
        value: reason && reason.trim() ? reason.slice(0, 1024) : '*Aucun motif renseigné.*',
        inline: false,
      },
    )
    .setFooter({ text: 'REBORN — sanction enregistrée sur ton passeport (compteur time-out).' });
  return e;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Applique un time-out temporaire à un membre (trace sur son passeport).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName('membre').setDescription('Cible').setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('duree')
        .setDescription('Ex. 30min, 2h, 7j, 2sem (combinable : 1j12h)')
        .setRequired(true),
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
      return interaction.reply({ content: '❌ Impossible sur un bot ou une application.' });
    }
    if (target.id === interaction.user.id) {
      return interaction.reply({ content: '❌ Tu ne peux pas te mute toi-même.' });
    }

    const durRaw = interaction.options.getString('duree', true);
    const parsed = parseMuteDuration(durRaw);
    if (!parsed.ok) {
      return interaction.reply({ content: `❌ ${parsed.error}` });
    }
    const mins = parsed.minutes;
    const reason = (interaction.options.getString('raison') || '').slice(0, 500);

    // Ack rapide : member.timeout() + SQLite peuvent dépasser 3 s sans defer.
    await interaction.deferReply();

    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);
    if (!member) {
      return interaction.editReply({
        content: '❌ Membre introuvable sur ce serveur.',
      });
    }

    if (
      member.roles?.highest?.position >=
      interaction.member.roles?.highest?.position
    ) {
      if (!isOwner(interaction.user.id)) {
        return interaction.editReply({
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
      return interaction.editReply({
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

    const minsTxt = humanizeMinutes(mins);
    const guildName = interaction.guild.name;

    if (r.applied) {
      let dmOk = false;
      try {
        const dmEmbed = buildSanctionDmEmbed({
          guildName,
          minsTxt,
          durSaisie: durRaw.trim(),
          reason,
        });
        await target.send({ embeds: [dmEmbed] });
        dmOk = true;
      } catch {
        /* MP fermés : le mute reste appliqué côté serveur */
      }
      const e = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('Mute appliqué')
        .setDescription(
          `${target} a été **mute** **${minsTxt}** (saisi : \`${durRaw.trim()}\`)${reason ? `\n**Motif :** ${reason}` : ''}\n\n*Logé sur le passeport REBORN.*${
            dmOk ? '' : '\n\n⚠️ *MP de notification non envoyé (DM fermés ou bloqués).*'
          }`,
        );
      return interaction.editReply({ embeds: [e] });
    }

    return interaction.editReply({
      content: `⚠️ Mute **logé** sur le passeport mais **non appliqué** (permissions Discord ?).\nErreur : \`${r.error || '—'}\``,
    });
  },
};
