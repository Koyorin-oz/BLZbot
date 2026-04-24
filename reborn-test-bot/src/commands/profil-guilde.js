const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db');
const pg = require('../services/playerGuilds');
const gm = require('../services/guildMember');
const { label } = require('../reborn/grades');
const { grpRankFromTotal } = require('../reborn/grades');

function findGuildOnHub(hubDiscordId, nomOrId) {
  const q = String(nomOrId || '').trim().toLowerCase();
  if (!q) return null;
  const list = pg.listGuildsOnHub(hubDiscordId);
  const byId = list.find((g) => g.id === nomOrId.trim());
  if (byId) return byId;
  return list.find((g) => String(g.name || '').toLowerCase().includes(q)) || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profil-guilde')
    .setDescription('Fiche guilde « joueur » REBORN (sandbox) — trésorerie, membres, GXP, grade.')
    .addStringOption((o) =>
      o
        .setName('nom')
        .setDescription('Nom ou ID de la guilde (défaut : la tienne sur ce serveur)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.', ephemeral: true });
    const uid = interaction.user.id;
    const raw = interaction.options.getString('nom');
    let gRow = null;
    if (raw && raw.trim()) {
      gRow = findGuildOnHub(hub, raw);
      if (!gRow) return interaction.reply({ content: 'Guilde introuvable sur ce serveur (nom ou ID).', ephemeral: true });
    } else {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) {
        return interaction.reply({
          content: 'Tu n’es dans aucune guilde **joueur** sur ce serveur. Indique un **nom** ou **ID** (`/guilde liste`).',
          ephemeral: true,
        });
      }
      gRow = pg.getGuild(m.guild_id);
    }
    const g = pg.getGuild(gRow.id);
    if (!g || g.hub_discord_id !== hub) return interaction.reply({ content: 'Guilde invalide.', ephemeral: true });

    const members = pg.db
      ? null
      : null;
    const db = require('../db');
    const memRows = db.prepare('SELECT user_id, joined_ms FROM player_guild_members WHERE guild_id = ? ORDER BY joined_ms').all(g.id);
    const n = memRows.length;
    const lines = [];
    for (const { user_id } of memRows.slice(0, 12)) {
      const tag = `<@${user_id}>`;
      const mark = user_id === g.leader_id ? '👑' : '';
      lines.push(`${mark}${tag}`);
    }
    const extra = n > 12 ? `\n… +**${n - 12}** autre(s)` : '';
    const { grp } = gm.getMemberRow(hub, g.leader_id);
    const rk = grpRankFromTotal(grp);

    const e = new EmbedBuilder()
      .setTitle(g.name || 'Guilde')
      .setColor(0xe74c3c)
      .setDescription(
        `**ID** \`${g.id}\`\n**Chef** <@${g.leader_id}>\n**Membres** ${n} / **${g.member_cap}**\n**Niveau guilde** ${g.guild_level}\n**Grade** ${label(g.grade || '')}\n**GXP (guilde)** ${BigInt(g.gxp || '0').toLocaleString('fr-FR')}\n**Trésorerie** ${BigInt(g.treasury || '0').toLocaleString('fr-FR')} starss\n**Anti-séparation** ${g.anti_separation ? 'oui' : 'non'}\n**GRP chef (ce serveur, indicatif)** ${rk || '—'}`,
      )
      .addFields({
        name: 'Membres',
        value: (lines.join('\n') + extra || '—').slice(0, 1000),
      })
      .setFooter({
        text: 'REBORN test-bot — guilde « joueur » (/guilde). Pas le canvas du bot principal.',
      });
    return interaction.reply({ embeds: [e], ephemeral: true });
  },
};
