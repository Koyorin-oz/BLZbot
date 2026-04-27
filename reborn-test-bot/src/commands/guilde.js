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
        .setDescription('Inviter un membre (chef ou permission « rôles »)')
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
        .setDescription('Retirer des starss (chef ou permission « retrait »)')
        .addStringOption((o) => o.setName('montant').setDescription('Starss').setRequired(true)),
    )
    .addSubcommand((sc) => sc.setName('tresor_voir').setDescription('Voir la trésorerie'))
    .addSubcommand((sc) => sc.setName('grade_up').setDescription('Acheter le prochain grade (chef)'))
    .addSubcommand((sc) =>
      sc
        .setName('perm_voir')
        .setDescription('Voir les permissions guilde (toi ou un membre)')
        .addUserOption((o) => o.setName('membre').setDescription('Membre (chef)').setRequired(false)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('perm_set')
        .setDescription('Définir une permission pour un membre (chef)')
        .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('cle')
            .setDescription('Permission')
            .setRequired(true)
            .addChoices(
              { name: 'Dépôt trésorerie', value: 'depot' },
              { name: 'Retrait trésorerie', value: 'retrait' },
              { name: 'Expulsion membre', value: 'kick' },
              { name: 'Invitations', value: 'roles' },
              { name: 'Lancer un focus', value: 'focus' },
            ),
        )
        .addBooleanOption((o) => o.setName('actif').setDescription('Activé').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('expulser')
        .setDescription('Expulser un membre (chef ou permission « kick »)')
        .addUserOption((o) => o.setName('membre').setDescription('Membre à expulser').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('transferer_chef')
        .setDescription('Transférer le lead à un membre (chef actuel)')
        .addUserOption((o) => o.setName('nouveau_chef').setDescription('Membre').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('dissoudre')
        .setDescription('Supprimer la guilde (chef, irréversible)'),
    )
    .addSubcommand((sc) =>
      sc
        .setName('focus')
        .setDescription('Focus guilde (500k trésorerie, CD 7j) — chef ou permission « focus »')
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
      await interaction.reply({ content: 'Sur un serveur uniquement.' });
      return;
    }
    const uid = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'creer') {
      const nom = interaction.options.getString('nom', true);
      const r = pg.createGuild(hub, uid, interaction.user.username, nom);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: `Guilde créée — ID : **${r.guildId}**` });
    }

    if (sub === 'rejoindre') {
      const gid = interaction.options.getString('guild_id', true).trim();
      const r = pg.joinGuild(hub, uid, interaction.user.username, gid);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: 'Tu as rejoint la guilde.' });
    }

    if (sub === 'quitter') {
      const r = pg.leaveGuild(hub, uid);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: 'Tu as quitté la guilde.' });
    }

    if (sub === 'liste') {
      const list = pg.listGuildsOnHub(hub);
      if (!list.length) return interaction.reply({ content: 'Aucune guilde.' });
      const lines = list.map(
        (g) =>
          `• **${g.name}** \`${g.id}\` — nv **${g.guild_level}** — grade **${label(g.grade || '')}** — trésor **${BigInt(g.treasury || '0').toLocaleString('fr-FR')}**`,
      );
      return interaction.reply({ content: lines.join('\n').slice(0, 1900) });
    }

    if (sub === 'info') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.' });
      const g = pg.getGuild(m.guild_id);
      const n = pg.memberCount(m.guild_id);
      const e = new EmbedBuilder()
        .setTitle(g.name)
        .setDescription(
          `ID \`${g.id}\`\nChef <@${g.leader_id}>\nMembres **${n}** / **${g.member_cap}**\nNiveau guilde **${g.guild_level}**\nGrade **${label(g.grade || '')}**\nGXP **${BigInt(g.gxp || '0').toLocaleString('fr-FR')}**\nTrésorerie **${BigInt(g.treasury || '0').toLocaleString('fr-FR')}** starss\nAnti-séparation : **${g.anti_separation ? 'oui' : 'non'}**`,
        )
        .setColor(0xe67e22);
      return interaction.reply({ embeds: [e] });
    }

    if (sub === 'inviter') {
      const u = interaction.options.getUser('membre', true);
      const m = pg.getMembershipInHub(uid, hub);
      if (!m || !pg.canInviteMembers(m.guild_id, uid)) {
        return interaction.reply({ content: 'Réservé au chef ou permission « invitations ».' });
      }
      const r = pg.joinGuild(hub, u.id, u.username, m.guild_id);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: `${u} a été ajouté à la guilde.` });
    }

    if (sub === 'tresor_depot') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.' });
      let amt;
      try {
        amt = parseBig(interaction.options.getString('montant', true));
      } catch {
        return interaction.reply({ content: 'Montant invalide.' });
      }
      const r = pg.treasuryDeposit(m.guild_id, uid, amt);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: 'Dépôt effectué.' });
    }

    if (sub === 'tresor_retrait') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.' });
      let amt;
      try {
        amt = parseBig(interaction.options.getString('montant', true));
      } catch {
        return interaction.reply({ content: 'Montant invalide.' });
      }
      const r = pg.treasuryWithdraw(m.guild_id, uid, amt);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: 'Retrait effectué.' });
    }

    if (sub === 'tresor_voir') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.' });
      const v = pg.treasuryView(m.guild_id);
      return interaction.reply({ content: `Trésorerie : **${v.toLocaleString('fr-FR')}** starss` });
    }

    if (sub === 'grade_up') {
      const r = pg.tryBuyNextGrade(hub, uid);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: `Grade acquis : **${r.label}**` });
    }

    if (sub === 'perm_voir') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.' });
      const target = interaction.options.getUser('membre') || interaction.user;
      if (target.id !== uid && m.leader_id !== uid) {
        return interaction.reply({ content: 'Voir les perms d’un autre : chef uniquement.' });
      }
      const tm = pg.memberRow(m.guild_id, target.id);
      if (!tm) return interaction.reply({ content: 'Cible pas dans ta guilde.' });
      const p = pg.getMemberPerms(m.guild_id, target.id);
      const txt = p
        ? `depot **${p.depot}** · retrait **${p.retrait}** · kick **${p.kick}** · roles **${p.roles}** · focus **${p.focus}**`
        : '—';
      return interaction.reply({ content: `Permissions <@${target.id}> : ${txt}` });
    }

    if (sub === 'perm_set') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m || m.leader_id !== uid) return interaction.reply({ content: 'Chef uniquement.' });
      const target = interaction.options.getUser('membre', true);
      const cle = interaction.options.getString('cle', true);
      const actif = interaction.options.getBoolean('actif', true);
      const tm = pg.memberRow(m.guild_id, target.id);
      if (!tm) return interaction.reply({ content: 'Membre pas dans la guilde.' });
      const r = pg.setMemberPerm(m.guild_id, uid, target.id, cle, actif);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: `Permission **${cle}** → **${actif ? 'oui' : 'non'}** pour ${target}.` });
    }

    if (sub === 'expulser') {
      const target = interaction.options.getUser('membre', true);
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.' });
      const r = pg.kickMember(hub, m.guild_id, uid, target.id);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: `${target} a été expulsé de la guilde.` });
    }

    if (sub === 'transferer_chef') {
      const neo = interaction.options.getUser('nouveau_chef', true);
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.' });
      const r = pg.transferLeadership(hub, m.guild_id, uid, neo.id);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: `Lead transféré à ${neo}. Tu restes membre avec les perms par défaut.` });
    }

    if (sub === 'dissoudre') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.' });
      const r = pg.dissolveGuild(hub, m.guild_id, uid);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: 'Guilde dissoute (données effacées pour ce test-bot).' });
    }

    if (sub === 'focus') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Pas de guilde.' });
      const target = interaction.options.getString('cible_guild_id', true).trim();
      const mode = interaction.options.getString('mode', true);
      const r = pg.useFocus(hub, m.guild_id, target, mode, uid);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: 'Focus appliqué.' });
    }
  },
};
