/**
 * Audit & log des Focus de guilde.
 * Écrit dans la table `staff_audit` (chaque action staff laisse une trace) et
 * pousse un embed dans le salon `FOCUS_LOG_CHANNEL_ID` (ou `LOGS_CHANNEL_ID`
 * en fallback) pour que les admins suivent les abus en temps réel.
 */

const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const playerGuilds = require('./playerGuilds');

function focusLogChannelId() {
  return (
    String(process.env.FOCUS_LOG_CHANNEL_ID || '').trim() ||
    String(process.env.LOGS_CHANNEL_ID || '').trim() ||
    null
  );
}

function recordAudit(hubDiscordId, modId, targetId, action, details) {
  try {
    db.prepare(
      `INSERT INTO staff_audit (hub_discord_id, mod_id, target_id, action, details, created_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(hubDiscordId, modId, targetId, action, details || '', Date.now());
  } catch (e) {
    console.error('[focusAudit] record', e?.message || e);
  }
}

/**
 * Construit + poste un embed de log focus.
 * @param {import('discord.js').Client} client
 * @param {object} payload
 */
async function sendFocusLog(client, payload) {
  const chanId = focusLogChannelId();
  if (!chanId || !client) return;
  try {
    const ch = await client.channels.fetch(chanId).catch(() => null);
    if (!ch || !ch.isTextBased?.()) return;
    const att = playerGuilds.getGuild(payload.attackerGuildId);
    const tgt = playerGuilds.getGuild(payload.targetGuildId);
    const modeLabels = {
      '1': '-500 GRP par membre cible',
      '2': '-3 000 GRP répartis',
      '3': '÷2 GRP cible pendant 2 h',
    };
    const e = new EmbedBuilder()
      .setTitle('🎯 Focus de guilde lancé')
      .setColor(0xe67e22)
      .addFields(
        {
          name: 'Attaquant',
          value: `**${att?.name || payload.attackerGuildId}** (\`${payload.attackerGuildId}\`)\nLancé par <@${payload.actorUserId}>`,
          inline: true,
        },
        {
          name: 'Cible',
          value: `**${tgt?.name || payload.targetGuildId}** (\`${payload.targetGuildId}\`)`,
          inline: true,
        },
        {
          name: 'Mode',
          value: modeLabels[payload.mode] || `mode ${payload.mode}`,
          inline: false,
        },
      )
      .setFooter({ text: 'Coût : 500 000 starss · CD : 7 jours' })
      .setTimestamp();
    if (payload.note) e.addFields({ name: 'Note', value: payload.note });
    await ch.send({ embeds: [e] }).catch(() => {});
  } catch (err) {
    console.error('[focusAudit] sendFocusLog', err?.message || err);
  }
}

/**
 * Liste l'historique focus pour une guilde (dernier focus, total).
 */
function focusHistoryForGuild(guildId) {
  const total = db
    .prepare(
      "SELECT COUNT(*) AS c FROM staff_audit WHERE action = 'focus.use' AND (mod_id = ? OR target_id = ?)",
    )
    .get(guildId, guildId).c;
  const recent = db
    .prepare(
      "SELECT mod_id, target_id, details, created_ms FROM staff_audit WHERE action = 'focus.use' AND (mod_id = ? OR target_id = ?) ORDER BY created_ms DESC LIMIT 10",
    )
    .all(guildId, guildId);
  return { total, recent };
}

module.exports = { recordAudit, sendFocusLog, focusHistoryForGuild, focusLogChannelId };
