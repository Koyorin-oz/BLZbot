require('dotenv').config();

const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  PermissionsBitField,
  ApplicationCommandOptionType,
} = require('discord.js');

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const rolesPoints = {
  "1323240945235529748": 0,
  "1323241032770654289": 1,
  "1323241034855223348": 3,
  "1404222782891495424": 4,
  "1323241037392642129": 5,
  "1323241046154678313": 6,
  "1012686884369080330": 6,
  "1323241048029528105": 7,
  "1172237685763608579": 0
};

const votesFilePath = path.join(__dirname, 'votes.json');

let votes = {};
if (fs.existsSync(votesFilePath)) {
  votes = JSON.parse(fs.readFileSync(votesFilePath, 'utf8'));
}

let modoTestData = {};

function saveVotes() {
  fs.writeFileSync(votesFilePath, JSON.stringify(votes, null, 2), 'utf8');
}

const commands = [
  {
    name: 'vote',
    description: 'Démarrer un vote pour un utilisateur',
    options: [
      {
        type: ApplicationCommandOptionType.User,
        name: 'utilisateur',
        description: 'Utilisateur pour le vote',
        required: true,
      },
    ],
  },
  {
    name: 'candid',
    description: 'Lancer un vote pour devenir modérateur test',
    options: [
      {
        type: ApplicationCommandOptionType.User,
        name: 'utilisateur',
        description: 'Utilisateur candidat',
        required: true,
      },
    ],
  },
  {
    name: 'bvote',
    description: 'Démarrer un vote personnalisé',
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'sujet',
        description: 'Sujet du vote',
        required: true,
      },
    ],
  },
  {
    name: 'rankup',
    description: 'Démarrer un vote de promotion',
    options: [
      {
        type: ApplicationCommandOptionType.User,
        name: 'utilisateur',
        description: 'Utilisateur à promouvoir',
        required: true,
      },
      {
        type: ApplicationCommandOptionType.String,
        name: 'type',
        description: 'Le type de promotion',
        required: true,
        choices: [
          { name: 'Modérateur test > Modérateur', value: 'modo_test_to_modo' },
          { name: 'Superviseur > Administrateur Test', value: 'superviseur_to_admin_test' },
          { name: 'Administrateur Test > Administrateur', value: 'admin_test_to_admin' },
        ],
      },
    ],
  },
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Enregistrement des commandes via POST...');
    for (const command of commands) {
      await rest.post(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: command }
      );
    }
    console.log('Commandes enregistrées avec succès.');
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement des commandes :', error);
  }
})();


client.once('ready', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  schedule.scheduleJob('0 * * * *', checkModoTestPeriod);
  schedule.scheduleJob('*/10 * * * *', checkVotesPeriod);
});

async function checkModoTestPeriod() {
  const now = new Date();
  for (const userId in modoTestData) {
    const endDate = new Date(modoTestData[userId]);
    if (now >= endDate) {
      delete modoTestData[userId];

      const guild = await client.guilds.fetch(GUILD_ID);
      const member = await guild.members.fetch(userId);

      if (member) {
        await startVote(member.user, 'Fin de période de test pour', client.channels.cache.get('1343195904399773706'));
      }
    }
  }
}

async function startVote(user, reason, channel, voteType) {
  const embed = new EmbedBuilder()
    .setTitle(`${reason} ${user.username}`)
    .setDescription(`Votez pour <@${user.id}> !`)
    .addFields(
      { name: 'Oui', value: '0', inline: true },
      { name: 'Non', value: '0', inline: true }
    )
    .setColor('#00FF00');

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('vote_oui')
        .setLabel('Oui')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('vote_non')
        .setLabel('Non')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('fin_vote')
        .setLabel('Fin du Vote')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!channel.permissionsFor(channel.guild.members.me).has(PermissionsBitField.Flags.Administrator))
    );

  const sent = await channel.send({ embeds: [embed], components: [row] });

  votes[user.id] = {
    oui: 0,
    non: 0,
    voters: {},
    type: voteType || 'standard',
    createdAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48 heure
    channelId: channel.id,
    messageId: sent.id,
  };

  saveVotes();
}

async function startRankupVote(user, promotionType, interaction) {
  const channel = interaction.channel;
  const embed = new EmbedBuilder()
    .setTitle(`Vote de promotion pour ${user.username}`)
    .setDescription(`Promotion : **${promotionType}**\nVotez pour <@${user.id}> !`)
    .addFields(
      { name: 'Oui', value: '0', inline: true },
      { name: 'Non', value: '0', inline: true }
    )
    .setColor('#00BFFF');

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('vote_oui')
        .setLabel('Oui')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('vote_non')
        .setLabel('Non')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('fin_rankup_vote')
        .setLabel('Fin du Vote')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
    );

  const sent = await channel.send({ embeds: [embed], components: [row] });

  votes[user.id] = {
    oui: 0,
    non: 0,
    voters: {},
    type: promotionType,
    createdAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    channelId: channel.id,
    messageId: sent.id,
  };

  saveVotes();

  await interaction.reply({
    content: `Le vote de promotion pour <@${user.id}> a commencé !`,
    ephemeral: true,
  });
}

async function startCustomVote(interaction, sujet) {
  const channel = interaction.channel;

  const embed = new EmbedBuilder()
    .setTitle(`Vote : ${sujet}`)
    .setDescription(`Votez pour le sujet : **${sujet}**`)
    .addFields(
      { name: 'Oui', value: '0', inline: true },
      { name: 'Non', value: '0', inline: true }
    )
    .setColor('#FFA500');

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('vote_oui')
        .setLabel('Oui')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('vote_non')
        .setLabel('Non')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('fin_bvote')
        .setLabel('Fin du Vote')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
    );

  const sent = await channel.send({ embeds: [embed], components: [row] });

  votes[sujet] = {
    oui: 0,
    non: 0,
    voters: {},
    type: 'custom',
    createdAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    channelId: channel.id,
    messageId: sent.id,
  };

  saveVotes();

  await interaction.reply({
    content: `Le vote pour "${sujet}" a commencé !`,
    ephemeral: true,
  });
}

async function checkVotesPeriod() {
  const now = new Date();
  for (const sujet in votes) {
    const vote = votes[sujet];
    if (!vote.endsAt) continue;
    const endDate = new Date(vote.endsAt);
    if (now >= endDate) {
      try {
        const channel = vote.channelId ? await client.channels.fetch(vote.channelId).catch(() => null) : null;
        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        const member = await (guild ? guild.members.fetch(sujet).catch(() => null) : null);

        let finalMessage = '';
        let promoteUser = false;
        let rejectUser = false;

        if (vote['oui'] > vote['non']) {
          finalMessage = `Le vote est terminé pour ${member ? `<@${sujet}>` : `"${sujet}"`} : il a été **accepté** avec ${vote['oui']} voix pour et ${vote['non']} voix contre.`;
          promoteUser = true;
        } else if (vote['oui'] < vote['non']) {
          finalMessage = `Le vote est terminé pour ${member ? `<@${sujet}>` : `"${sujet}"`} : il a été **refusé** avec ${vote['oui']} voix pour et ${vote['non']} voix contre.`;
          rejectUser = true;
        } else {
          finalMessage = `Le vote pour ${member ? `<@${sujet}>` : `"${sujet}"`} est **à égalité** avec ${vote['oui']} voix pour et ${vote['non']} voix contre.`;
        }

        if (channel) {
          await channel.send(finalMessage).catch(() => null);
        } else if (client.channels.cache.size > 0) {
          // Fallback 
          const fallback = client.channels.cache.first();
          if (fallback) await fallback.send(finalMessage).catch(() => null);
        }

        if (member) {
          const serverName = 'BLZstarss';
          const serverIcon = guild?.iconURL?.({ size: 1024, extension: 'png' });
          const inviteUrl = 'https://discord.gg/qJ4kgDb4Dg';

          if (promoteUser) {
              switch (vote.type) {

                  case 'candidature': {
                      await member.roles.add('1323240945235529748').catch(() => null);

                      const endDate = new Date();
                      endDate.setDate(endDate.getDate() + 14);
                      modoTestData[sujet] = endDate.toISOString();

                      const embed = new EmbedBuilder()
                          .setTitle('🎉 Félicitations !')
                          .setAuthor({
                              name: serverName,
                              iconURL: serverIcon,
                              url: inviteUrl
                          })
                          .setDescription(
                              'Votre candidature a été acceptée !\n\n' +
                              'Vous êtes désormais **Modérateur Test** pour une période de **14 jours**.\n\n' +
                              '**Bonne chance dans vos nouvelles fonctions !**'
                          )
                          .setThumbnail(member.user.displayAvatarURL({ size: 512, extension: 'png' }))
                          .setColor('#00FF7F')
                          .setFooter({ text: `${serverName} • Équipe de modération` })
                          .setTimestamp();

                      await member.send({ embeds: [embed] }).catch(() => null);
                      break;
                  }

                  case 'modo_test_to_modo': {
                      await member.roles.remove('1323240945235529748').catch(() => null);
                      await member.roles.add('1323241032770654289').catch(() => null);

                      const embed = new EmbedBuilder()
                          .setTitle('🏆 Promotion obtenue !')
                          .setAuthor({
                              name: serverName,
                              iconURL: serverIcon,
                              url: inviteUrl
                          })
                          .setDescription(
                              'Après votre période de test, vous avez été promu au grade de **Modérateur Permanent**.\n\n' +
                              'Merci pour votre investissement et votre sérieux.'
                          )
                          .setThumbnail(member.user.displayAvatarURL({ size: 512, extension: 'png' }))
                          .setColor('#0099FF')
                          .setFooter({ text: `${serverName} • Équipe de modération` })
                          .setTimestamp();

                      await member.send({ embeds: [embed] }).catch(() => null);
                      break;
                  }

                  case 'superviseur_to_admin_test': {
                      await member.roles.add('1404222782891495424').catch(() => null);

                      const embed = new EmbedBuilder()
                          .setTitle('🚀 Nouvelle responsabilité')
                          .setAuthor({
                              name: serverName,
                              iconURL: serverIcon,
                              url: inviteUrl
                          })
                          .setDescription(
                              'Vous avez été sélectionné pour devenir **Administrateur Test**.\n\n' +
                              'Cette promotion récompense votre implication au sein du serveur.'
                          )
                          .setThumbnail(member.user.displayAvatarURL({ size: 512, extension: 'png' }))
                          .setColor('#5865F2')
                          .setFooter({ text: `${serverName} • Équipe de modération` })
                          .setTimestamp();

                      await member.send({ embeds: [embed] }).catch(() => null);
                      break;
                  }

                  case 'admin_test_to_admin': {
                      await member.roles.remove('1404222782891495424').catch(() => null);
                      await member.roles.add('1323241037392642129').catch(() => null);

                      const embed = new EmbedBuilder()
                          .setTitle('👑 Promotion validée')
                          .setAuthor({
                              name: serverName,
                              iconURL: serverIcon,
                              url: inviteUrl
                          })
                          .setDescription(
                              'Votre période de test est terminée avec succès !\n\n' +
                              'Vous êtes désormais **Administrateur Permanent**.'
                          )
                          .setThumbnail(member.user.displayAvatarURL({ size: 512, extension: 'png' }))
                          .setColor('#FFD700')
                          .setFooter({ text: `${serverName} • Équipe de modération` })
                          .setTimestamp();

                      await member.send({ embeds: [embed] }).catch(() => null);
                      break;
                  }

                  default:
                      break;
              }
          } else if (rejectUser && vote.type === 'candidature') {

              const embed = new EmbedBuilder()
                  .setTitle('💛 Merci pour votre candidature')
                  .setAuthor({
                      name: serverName,
                      iconURL: serverIcon,
                      url: inviteUrl
                  })
                  .setDescription(
                      'Après délibération, votre candidature n\'a malheureusement pas été retenue cette fois-ci.\n\n' +
                      'Nous vous remercions sincèrement pour l\'intérêt que vous portez au serveur et vous encourageons à retenter votre chance plus tard.'
                  )
                  .setThumbnail(member.user.displayAvatarURL({ size: 512, extension: 'png' }))
                  .setColor('#FFA500')
                  .setFooter({ text: `${serverName} • Équipe de modération` })
                  .setTimestamp();

              await member.send({ embeds: [embed] }).catch(() => null);
          }
        }
        if (vote.channelId && vote.messageId) {
          const ch = await client.channels.fetch(vote.channelId).catch(() => null);
          if (ch) {
            const msg = await ch.messages.fetch(vote.messageId).catch(() => null);
            if (msg) {
              const disabledRow = new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId('vote_oui')
                    .setLabel('Oui')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true),
                  new ButtonBuilder()
                    .setCustomId('vote_non')
                    .setLabel('Non')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(true),
                  new ButtonBuilder()
                    .setCustomId('fin_vote')
                    .setLabel('Fin du Vote')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
                );
              await msg.edit({ components: [disabledRow] }).catch(() => null);
            }
          }
        }

        delete votes[sujet];
        saveVotes();
      } catch (err) {
        console.error('Erreur lors de la clôture automatique d\'un vote :', err);
      }
    }
  }
}

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isCommand()) {
      const { commandName } = interaction;

      const isStaff = interaction.member.roles.cache.has('1172237685763608579');
      const hasSuperviseurRank = interaction.member.roles.cache.has('1323241034855223348');
      const hasAdminRank = interaction.member.roles.cache.has('1323241037392642129');
      const hasChefRank = interaction.member.roles.cache.has('1323241046154678313');
      const hasOwnerRank = interaction.member.roles.cache.has('1323241048029528105');

      if (commandName === 'vote' || commandName === 'candid') {
        if (!isStaff) {
          await interaction.reply({
            content: "Vous n'avez pas la permission de démarrer ce vote.",
            ephemeral: true,
          });
          return;
        }
      }

      if (commandName === 'rankup') {
        const user = interaction.options.getUser('utilisateur');
        const type = interaction.options.getString('type');

        if (votes[user.id]) {
          await interaction.reply({
            content: 'Un vote est déjà en cours pour cet utilisateur.',
            ephemeral: true,
          });
          return;
        }

        let hasPermission = false;
        switch (type) {
          case 'modo_test_to_modo':
            if (hasSuperviseurRank || hasAdminRank || hasChefRank || hasOwnerRank) hasPermission = true;
            break;
          case 'superviseur_to_admin_test':
            if (hasAdminRank || hasChefRank || hasOwnerRank) hasPermission = true;
            break;
          case 'admin_test_to_admin':
            if (hasChefRank || hasOwnerRank) hasPermission = true;
            break;
        }

        if (!hasPermission) {
          await interaction.reply({
            content: "Vous n'avez pas la permission de lancer ce vote de promotion.",
            ephemeral: true,
          });
          return;
        }

        await startRankupVote(user, type, interaction);
      } else if (commandName === 'vote') {
        const user = interaction.options.getUser('utilisateur');

        if (votes[user.id]) {
          await interaction.reply({
            content: 'Un vote est déjà en cours pour cet utilisateur.',
            ephemeral: true,
          });
          return;
        }
        
        await startVote(user, 'Vote pour', interaction.channel, 'standard');

        await interaction.reply({
          content: `Le vote pour <@${user.id}> a commencé !`,
          ephemeral: true,
        });
      } else if (commandName === 'candid') {
        const user = interaction.options.getUser('utilisateur');
        
        if (votes[user.id]) {
          await interaction.reply({
            content: 'Un vote est déjà en cours pour cet utilisateur.',
            ephemeral: true,
          });
          return;
        }

        await startVote(user, 'Candidature pour Modérateur Test', interaction.channel, 'candidature');

        await interaction.reply({
          content: `Le vote pour la candidature de <@${user.id}> a commencé !`,
          ephemeral: true,
        });
      } else if (commandName === 'bvote') {
        const sujet = interaction.options.getString('sujet');

        if (votes[sujet]) {
          await interaction.reply({
            content: 'Un vote est déjà en cours pour ce sujet.',
            ephemeral: true,
          });
          return;
        }

        await startCustomVote(interaction, sujet);
      } else {
        return;
      }
    } else if (interaction.isButton()) {
      let sujet = null;
      const embed = interaction.message.embeds[0];

      if (embed && embed.title && embed.title.startsWith('Vote : ')) {
        sujet = embed.title.substring(7);
      } else if (embed && embed.description) {
        const userIdMatch = embed.description.match(/<@(\d+)>/);
        if (userIdMatch) {
          sujet = userIdMatch[1];
        } else {
          return;
        }
      } else {
        return;
      }

      if (!votes[sujet]) {
        return;
      }

      let canVote = false;
      const voterMember = interaction.member;
      const voterRoles = voterMember.roles.cache;
      const voteType = votes[sujet].type;

      let hasPermissionToManageVote = false;
      const isStaff = voterRoles.has('1172237685763608579');
  const isSpecialRole = voterRoles.has('1234480190382407734');
      const hasSuperviseurRank = voterRoles.has('1323241034855223348');
      const hasAdminRank = voterRoles.has('1323241037392642129');
      const hasChefRank = voterRoles.has('1323241046154678313');
      const hasOwnerRank = voterRoles.has('1323241048029528105');

      switch (voteType) {
        case 'candidature':
        case 'standard':
        case 'custom':
          if (isStaff || isSpecialRole) hasPermissionToManageVote = true;
          break;
        case 'modo_test_to_modo':
          if (hasSuperviseurRank || hasAdminRank || hasChefRank || hasOwnerRank) hasPermissionToManageVote = true;
          break;
        case 'superviseur_to_admin_test':
          if (hasAdminRank || hasChefRank || hasOwnerRank) hasPermissionToManageVote = true;
          break;
        case 'admin_test_to_admin':
          if (hasChefRank || hasOwnerRank) hasPermissionToManageVote = true;
          break;
      }

      switch (voteType) {
        case 'candidature':
          if (isStaff && !voterRoles.has('1323240945235529748')) {
            canVote = true;
          }
          break;
        case 'modo_test_to_modo':
          if (isStaff && !voterRoles.has('1323240945235529748') && !voterRoles.has('1323241032770654289')) {
            canVote = true;
          }
          break;
        case 'superviseur_to_admin_test':
          if (hasAdminRank || hasChefRank || hasOwnerRank) {
            canVote = true;
          }
          break;
        case 'admin_test_to_admin':
          if (hasChefRank || hasOwnerRank) {
            canVote = true;
          }
          break;
        case 'standard':
        case 'custom':
        default:
          const rolePoints = voterRoles.reduce((max, role) => {
            if (rolesPoints[role.id] !== undefined) {
              return Math.max(max, rolesPoints[role.id]);
            }
            return max;
          }, 0);
          if (rolePoints > 0) canVote = true;
          break;
      }

      if (interaction.customId === 'vote_oui' || interaction.customId === 'vote_non') {
        if (!canVote) {
          await interaction.reply({
            content: "Vous n'avez pas la permission de voter pour cette promotion.",
            ephemeral: true,
          });
          return;
        }

        const voteChoice = interaction.customId === 'vote_oui' ? 'oui' : 'non';
        const oppositeVoteChoice = voteChoice === 'oui' ? 'non' : 'oui';
        
        const voterHighestRolePoints = voterMember.roles.cache.reduce((max, role) => {
            return Math.max(max, rolesPoints[role.id] || 0);
        }, 0);

        const voteWeight = voterHighestRolePoints > 0 ? voterHighestRolePoints : 1;
        
        const voterId = interaction.user.id;
        let message;

        if (votes[sujet].voters[voterId]) {
            const previousVote = votes[sujet].voters[voterId];
            if (previousVote === voteChoice) {
                votes[sujet][voteChoice] -= voteWeight;
                delete votes[sujet].voters[voterId];
                message = `Votre vote a été annulé.`;
            } else {
                votes[sujet][previousVote] -= voteWeight;
                votes[sujet][voteChoice] += voteWeight;
                votes[sujet].voters[voterId] = voteChoice;
                message = `Votre vote a été mis à jour pour "${voteChoice}".`;
            }
        } else {
            votes[sujet][voteChoice] += voteWeight;
            votes[sujet].voters[voterId] = voteChoice;
            message = `Votre vote pour "${voteChoice}" a été enregistré.`;
        }
        

        const updatedEmbed = EmbedBuilder.from(embed)
          .setFields(
            { name: 'Oui', value: `${votes[sujet]['oui']}`, inline: true },
            { name: 'Non', value: `${votes[sujet]['non']}`, inline: true }
          );

        await interaction.update({
          embeds: [updatedEmbed],
          components: interaction.message.components,
        });

        await interaction.followUp({ content: message, ephemeral: true });

        saveVotes();
        
      } else if (
        interaction.customId === 'fin_vote' ||
        interaction.customId === 'fin_bvote' ||
        interaction.customId === 'fin_rankup_vote'
      ) {
        if (!hasPermissionToManageVote) {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: "Vous n'avez pas la permission d'effectuer cette action.",
              ephemeral: true,
            });
          }
          return;
        }

        const totalVotes = votes[sujet];
        const channel = interaction.channel;
        const member = await interaction.guild.members.fetch(sujet).catch(() => null);

        let finalMessage = '';
        let promoteUser = false;
        let rejectUser = false;
        
        if (totalVotes['oui'] > totalVotes['non']) {
            finalMessage = `Le vote est terminé pour <@${sujet}> : il a été **accepté** avec ${totalVotes['oui']} voix pour et ${totalVotes['non']} voix contre.`;
            promoteUser = true;
        } else if (totalVotes['oui'] < totalVotes['non']) {
            finalMessage = `Le vote est terminé pour <@${sujet}> : il a été **refusé** avec ${totalVotes['oui']} voix pour et ${totalVotes['non']} voix contre.`;
            rejectUser = true;
        } else {
            finalMessage = `Le vote pour <@${sujet}> est **à égalité** avec ${totalVotes['oui']} voix pour et ${totalVotes['non']} voix contre.`;
        }
        
        await channel.send(finalMessage);

        if (member) {
          const serverName = 'BLZstarss';
          const serverIcon = guild?.iconURL?.({ size: 1024, extension: 'png' });
          const inviteUrl = 'https://discord.gg/qJ4kgDb4Dg';

          if (promoteUser) {
              switch (totalVotes.type) {

                  case 'candidature': {
                      await member.roles.add('1323240945235529748');

                      const endDate = new Date();
                      endDate.setDate(endDate.getDate() + 14);
                      modoTestData[sujet] = endDate.toISOString();

                      const embed = new EmbedBuilder()
                          .setTitle('🎉 Félicitations !')
                          .setAuthor({
                              name: serverName,
                              iconURL: serverIcon,
                              url: inviteUrl
                          })
                          .setDescription(
                              'Votre candidature a été acceptée !\n\n' +
                              'Vous êtes désormais **Modérateur Test** pour une période de **14 jours**.\n\n' +
                              '**Bonne chance dans vos nouvelles fonctions !**'
                          )
                          .setThumbnail(member.user.displayAvatarURL({ size: 512, extension: 'png' }))
                          .setColor('#00FF7F')
                          .setFooter({ text: `${serverName} • Équipe de modération` })
                          .setTimestamp();

                      await member.send({ embeds: [embed] });
                      break;
                  }

                  case 'modo_test_to_modo': {
                      await member.roles.remove('1323240945235529748');
                      await member.roles.add('1323241032770654289');

                      const embed = new EmbedBuilder()
                          .setTitle('🏆 Promotion obtenue !')
                          .setAuthor({
                              name: serverName,
                              iconURL: serverIcon,
                              url: inviteUrl
                          })
                          .setDescription(
                              'Après votre période de test, vous avez été promu au grade de **Modérateur Permanent**.\n\n' +
                              'Merci pour votre investissement et votre sérieux.'
                          )
                          .setThumbnail(member.user.displayAvatarURL({ size: 512, extension: 'png' }))
                          .setColor('#0099FF')
                          .setFooter({ text: `${serverName} • Équipe de modération` })
                          .setTimestamp();

                      await member.send({ embeds: [embed] });
                      break;
                  }

                  case 'superviseur_to_admin_test': {
                      await member.roles.add('1404222782891495424');

                      const embed = new EmbedBuilder()
                          .setTitle('🚀 Nouvelle responsabilité')
                          .setAuthor({
                              name: serverName,
                              iconURL: serverIcon,
                              url: inviteUrl
                          })
                          .setDescription(
                              'Vous avez été sélectionné pour devenir **Administrateur Test**.\n\n' +
                              'Cette promotion récompense votre implication au sein du serveur.'
                          )
                          .setThumbnail(member.user.displayAvatarURL({ size: 512, extension: 'png' }))
                          .setColor('#5865F2')
                          .setFooter({ text: `${serverName} • Équipe de modération` })
                          .setTimestamp();

                      await member.send({ embeds: [embed] });
                      break;
                  }

                  case 'admin_test_to_admin': {
                      await member.roles.remove('1404222782891495424');
                      await member.roles.add('1323241037392642129');

                      const embed = new EmbedBuilder()
                          .setTitle('👑 Promotion validée')
                          .setAuthor({
                              name: serverName,
                              iconURL: serverIcon,
                              url: inviteUrl
                          })
                          .setDescription(
                              'Votre période de test est terminée avec succès !\n\n' +
                              'Vous êtes désormais **Administrateur Permanent**.'
                          )
                          .setThumbnail(member.user.displayAvatarURL({ size: 512, extension: 'png' }))
                          .setColor('#FFD700')
                          .setFooter({ text: `${serverName} • Équipe de modération` })
                          .setTimestamp();

                      await member.send({ embeds: [embed] });
                      break;
                  }

                  default:
                      break;
              }
          } else if (rejectUser && totalVotes.type === 'candidature') {

              const embed = new EmbedBuilder()
                  .setTitle('💛 Merci pour votre candidature')
                  .setAuthor({
                      name: serverName,
                      iconURL: serverIcon,
                      url: inviteUrl
                  })
                  .setDescription(
                      'Après délibération, votre candidature n\'a malheureusement pas été retenue cette fois-ci.\n\n' +
                      'Nous vous remercions sincèrement pour l\'intérêt que vous portez au serveur et vous encourageons à retenter votre chance ultérieurement.'
                  )
                  .setThumbnail(member.user.displayAvatarURL({ size: 512, extension: 'png' }))
                  .setColor('#FFA500')
                  .setFooter({ text: `${serverName} • Équipe de modération` })
                  .setTimestamp();

              await member.send({ embeds: [embed] });
          }
        }
        
        delete votes[sujet];
        saveVotes();

        const disabledRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('vote_oui')
              .setLabel('Oui')
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('vote_non')
              .setLabel('Non')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(interaction.customId)
              .setLabel('Fin du Vote')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );

        await interaction.message.edit({ components: [disabledRow] });

        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferUpdate();
        }
      } else {
        return;
      }
    } else {
      return;
    }
  } catch (error) {
    console.error('Erreur lors du traitement de l\'interaction :', error);

    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: 'Une erreur est survenue lors du traitement de votre action.',
          ephemeral: true,
        });
      } catch (err) {
        console.error('Erreur lors de l\'envoi du message d\'erreur :', err);
      }
    }
  }
});

client.login(TOKEN).catch(error => {
  console.error('Erreur lors de la connexion du bot :', error);
});
