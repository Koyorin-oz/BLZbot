const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const pg = require('../services/playerGuilds');
const { label } = require('../reborn/grades');

function parseBig(s) {
  return BigInt(String(s || '').replace(/\s/g, ''));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('guilde')
    .setDescription('Guildes REBORN (guilde « joueur », trésorerie, grades, focus).')
    .addSubcommand((sc) =>
      sc
        .setName('creer')
        .setDescription('Créer une guilde (nv 15+, gratuit, 5 places de base).')
        .addStringOption((o) => o.setName('nom').setDescription('Nom de la guilde').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('rejoindre')
        .setDescription('Rejoindre une guilde par ID')
        .addStringOption((o) => o.setName('guild_id').setDescription('ID guilde').setRequired(true)),
    )
    .addSubcommand((sc) => sc.setName('quitter').setDescription('Quitter ta guilde (pas le chef).'))
    .addSubcommand((sc) => sc.setName('info').setDescription('Infos sur ta guilde'))
    .addSubcommand((sc) => sc.setName('liste').setDescription('Liste des guildes sur ce serveur'))
    .addSubcommand((sc) =>
      sc
        .setName('inviter')
        .setDescription('Inviter un membre (chef)')
        .addUserOption((o) => o.setName('membre').setDescription('Joueur').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('tresor_depot')
        .setDescription('Déposer des starss en trésorerie')
        .addStringOption((o) => o.setName('montant').setDescription('Starss').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('tresor_retrait')
        .setDescription('Retirer des starss (chef)')
        .addStringOption((o) => o.setName('montant').setDescription('Starss').setRequired(true)),
    )
    .addSubcommand((sc) => sc.setName('tresor_voir').setDescription('Voir la trésorerie'))
    .addSubcommand((sc) => sc.setName('grade_up').setDescription('Acheter le prochain grade (chef)'))
    .addSubcommand((sc) =>
      sc
        .setName('focus')
        .setDescription('Focus guilde (500k trésorerie, CD 7j)')
        .addStringOption((o) =>
          o
            .setName('cible_guild_id')
            .setDescription('ID de la guilde cible (même serveur Discord)')
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Effet')
            .setRequired(true)
            .addChoices(
              { name: '-500 GRP / membre cible', value: '1' },
              { name: '-3000 GRP total réparti', value: '2' },
              { name: 'Marqueur ÷2 GRP (placeholder)', value: '3' },
            ),
        ),
    ),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) {
      await interaction.reply({ content: 'Sur un serveur uniquement.', ephemeral: true });
      return;
    }
    const uid = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'creer') {
      const nom = interaction.options.getString('nom', true);
      const r = pg.createGuild(hub, uid, interaction.user.username, nom);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({ content: `Guilde créée — ID : **${r.guildId}**`, ephemeral: true });
    }

    if (sub === 'rejoindre') {
      const gid = interaction.options.getString('guild_id', true).trim();
      const r = pg.joinGuild(hub, uid, interaction.user.username, gid);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({ content: 'Tu as rejoint la guilde.', ephemeral: true });
    }

    if (sub === 'quitter') {
      const r = pg.leaveGuild(hub, uid);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({ content: 'Tu as quitté la guilde.', ephemeral: true });
    }

    if (sub === 'liste') {
      const list = pg.listGuildsOnHub(hub);
      if (!list.length) return interaction.reply({ content: 'Aucune guilde.', ephemeral: true });
      const lines = list.map(
        (g) =>
          `• **${g.name}** \`${g.id}\` — nv **${g.guild_level}** — grade **${label(g.grade || '')}** — trésor **${BigInt(g.treasury || '0').toLocaleString('fr-FR')}**`,
      );
      return interaction.reply({ content: lines.join('\n').slice(0, 1900), ephemeral: true });
    }

    if (sub === 'info') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.', ephemeral: true });
      const g = pg.getGuild(m.guild_id);
      const n = pg.memberCount(m.guild_id);
      const e = new EmbedBuilder()
        .setTitle(g.name)
        .setDescription(
          `ID \`${g.id}\`\nChef <@${g.leader_id}>\nMembres **${n}** / **${g.member_cap}**\nNiveau guilde **${g.guild_level}**\nGrade **${label(g.grade || '')}**\nGXP **${BigInt(g.gxp || '0').toLocaleString('fr-FR')}**\nTrésorerie **${BigInt(g.treasury || '0').toLocaleString('fr-FR')}** starss\nAnti-séparation : **${g.anti_separation ? 'oui' : 'non'}**`,
        )
        .setColor(0xe67e22);
      return interaction.reply({ embeds: [e], ephemeral: true });
    }

    if (sub === 'inviter') {
      const u = interaction.options.getUser('membre', true);
      const m = pg.getMembershipInHub(uid, hub);
      if (!m || m.leader_id !== uid) return interaction.reply({ content: 'Réservé au chef.', ephemeral: true });
      const r = pg.joinGuild(hub, u.id, u.username, m.guild_id);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({ content: `${u} a été ajouté à la guilde.`, ephemeral: true });
    }

    if (sub === 'tresor_depot') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.', ephemeral: true });
      let amt;
      try {
        amt = parseBig(interaction.options.getString('montant', true));
      } catch {
        return interaction.reply({ content: 'Montant invalide.', ephemeral: true });
      }
      const r = pg.treasuryDeposit(m.guild_id, uid, amt);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({ content: 'Dépôt effectué.', ephemeral: true });
    }

    if (sub === 'tresor_retrait') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.', ephemeral: true });
      let amt;
      try {
        amt = parseBig(interaction.options.getString('montant', true));
      } catch {
        return interaction.reply({ content: 'Montant invalide.', ephemeral: true });
      }
      const r = pg.treasuryWithdraw(m.guild_id, uid, amt);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({ content: 'Retrait effectué.', ephemeral: true });
    }

    if (sub === 'tresor_voir') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.', ephemeral: true });
      const v = pg.treasuryView(m.guild_id);
      return interaction.reply({ content: `Trésorerie : **${v.toLocaleString('fr-FR')}** starss`, ephemeral: true });
    }

    if (sub === 'grade_up') {
      const r = pg.tryBuyNextGrade(hub, uid);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({ content: `Grade acquis : **${r.label}**`, ephemeral: true });
    }

    if (sub === 'focus') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m || m.leader_id !== uid) return interaction.reply({ content: 'Chef uniquement.', ephemeral: true });
      const target = interaction.options.getString('cible_guild_id', true).trim();
      const mode = interaction.options.getString('mode', true);
      const r = pg.useFocus(hub, m.guild_id, target, mode);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({ content: 'Focus appliqué.', ephemeral: true });
    }
  },
};
