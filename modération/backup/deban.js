// deban.js
// Ce fichier a été mis à jour pour inclure un système de candidature pour les modérateurs.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  REST,
  Routes,
  SlashCommandBuilder,
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  InteractionType,
  PermissionsBitField,
  ApplicationCommandOptionType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  LabelBuilder,
  FileUploadBuilder,
} = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = '1351221530998345828'; // Serveur où la commande /panel est enregistrée

// CONSTANTES POUR LE DÉBANNISSEMENT
const DEBAN_GUILD_ID = '1097110036192448656'; // ID du serveur où les demandes de débannissement sont envoyées
const DEBAN_CHANNEL_ID = '1382368378613796997'; // ID du salon où les demandes de débannissement sont envoyées
const MENTION_ROLE_ID = '1172237685763608579'; // ID du rôle à mentionner pour les nouvelles demandes

// CONSTANTES POUR LE RECRUTEMENT DE MODÉRATEUR
const RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID = '1323247488525795338'; // Salon où le message de recrutement est posté
const RECRUITMENT_CHANNEL_ID = '1343195997869834290'; // Salon où les votes de candidatures sont envoyés
// NOTE : Cet ID sera mis à jour dynamiquement si le message n'existe pas.
const RECRUITMENT_MESSAGE_ID = '1406013374365569074'; 
const STAFF_CHANNEL_ID = '1343195904399773706'; // Salon pour les votes de candidature (candid)
const RECRUITMENT_STATE_FILE_PATH = path.join(__dirname, 'recruitment_state.json');

// Définition des rôles et leurs points pour les votes (débannissement et recrutement)
const rolesPoints = {
  "1323240945235529748": 0, // modo_test
  "1323241032770654289": 1, // modo
  "1323241034855223348": 3, // superviseur
  "1404222782891495424": 4, // admin_test
  "1323241037392642129": 5, // admin
  "1323241046154678313": 6, // chef en carton
  "1323241048029528105": 7, // owner
  "1172237685763608579": 0, // Staff 
};

// -gestion

// Fichier pour les votes de débannissement
const DEBAN_VOTES_FILE_PATH = path.join(__dirname, 'deban_votes.json');
let debanVotes = {};
if (fs.existsSync(DEBAN_VOTES_FILE_PATH)) {
  try {
    debanVotes = JSON.parse(fs.readFileSync(DEBAN_VOTES_FILE_PATH, 'utf8'));
  } catch (e) {
    console.error("Erreur lors du chargement des votes de débannissement, utilisation des valeurs par défaut :", e);
    debanVotes = {};
  }
}
function saveDebanVotes() {
  fs.writeFileSync(DEBAN_VOTES_FILE_PATH, JSON.stringify(debanVotes, null, 2), 'utf8');
}

// Fichier pour l'état du recrutement (ouvert/fermé)
let recruitmentState = {};
if (fs.existsSync(RECRUITMENT_STATE_FILE_PATH)) {
  try {
    recruitmentState = JSON.parse(fs.readFileSync(RECRUITMENT_STATE_FILE_PATH, 'utf8'));
  } catch (e) {
    console.error("Erreur lors du chargement de l'état du recrutement, utilisation des valeurs par défaut :", e);
    recruitmentState = { open: false, places: 0, messageId: RECRUITMENT_MESSAGE_ID };
  }
}
function saveRecruitmentState() {
  fs.writeFileSync(RECRUITMENT_STATE_FILE_PATH, JSON.stringify(recruitmentState, null, 2), 'utf8');
}

// Fichier pour les votes de candidature (candid)
const CANDIDATE_VOTES_FILE_PATH = path.join(__dirname, 'candidate_votes.json');
let candidateVotes = {};
if (fs.existsSync(CANDIDATE_VOTES_FILE_PATH)) {
    try {
        candidateVotes = JSON.parse(fs.readFileSync(CANDIDATE_VOTES_FILE_PATH, 'utf8'));
    } catch (e) {
        console.error("Erreur lors du chargement des votes de candidature, utilisation des valeurs par défaut :", e);
        candidateVotes = {};
    }
}
function saveCandidateVotes() {
    fs.writeFileSync(CANDIDATE_VOTES_FILE_PATH, JSON.stringify(candidateVotes, null, 2), 'utf8');
}

// Fichier pour les demandes de débannissement en attente (ban < 3 mois)
const PENDING_DEBAN_REQUESTS_FILE_PATH = path.join(__dirname, 'pending_deban_requests.json');
let pendingDebanRequests = {};
if (fs.existsSync(PENDING_DEBAN_REQUESTS_FILE_PATH)) {
    try {
        pendingDebanRequests = JSON.parse(fs.readFileSync(PENDING_DEBAN_REQUESTS_FILE_PATH, 'utf8'));
    } catch (e) {
        console.error("Erreur lors du chargement des demandes en attente, utilisation des valeurs par défaut :", e);
        pendingDebanRequests = {};
    }
}
function savePendingDebanRequests() {
    fs.writeFileSync(PENDING_DEBAN_REQUESTS_FILE_PATH, JSON.stringify(pendingDebanRequests, null, 2), 'utf8');
}


// Ensemble pour stocker les IDs des utilisateurs ayant une demande de débannissement en cours (en mémoire)
const activeDebanRequests = new Set();
// Map pour stocker temporairement les réponses du formulaire (clé = ID de l'utilisateur)
const formData = new Map();

// cmds

const panelCommand = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Affiche le panneau de débannissement.')
  .toJSON();

const recrutementCommand = new SlashCommandBuilder()
  .setName('recrutement')
  .setDescription('Gère le recrutement des modérateurs.')
  .addStringOption(option =>
    option.setName('type')
      .setDescription('Ouvrir ou fermer le recrutement.')
      .setRequired(true)
      .addChoices(
        { name: 'ouvrir', value: 'ouvrir' },
        { name: 'fermer', value: 'fermer' }
      ))
  .addIntegerOption(option =>
    option.setName('places')
      .setDescription('Nombre de places disponibles.')
      .setRequired(false)
      .setMinValue(1))
  .toJSON();


(async () => {
  try {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    const guildCommands = {
      [GUILD_ID]: [panelCommand],
      [DEBAN_GUILD_ID]: [recrutementCommand]
    };

    for (const guildId in guildCommands) {
      const commandsForGuild = guildCommands[guildId];
      const commandNamesForGuild = new Set(commandsForGuild.map(cmd => cmd.name));

      console.log(`Synchronisation des commandes pour le serveur : ${guildId}`);

      // Récupérer les commandes existantes sur le serveur
      const existingCommands = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, guildId));

      // Filtrer les commandes pour ne garder que celles qui ne sont PAS gérées par ce bot
      const otherCommands = existingCommands.filter(cmd => !commandNamesForGuild.has(cmd.name));

      // Créer la liste finale en combinant les commandes des autres bots et celles de ce bot
      const finalCommands = [...otherCommands, ...commandsForGuild];

      // Mettre à jour les commandes sur le serveur
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, guildId), {
          body: finalCommands
        }
      );

      console.log(`Commandes synchronisées avec succès pour le serveur : ${guildId}`);
    }

  } catch (error) {
    console.error('Erreur lors du déploiement des commandes :', error);
  }
})();

// Création du client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ]
});

// --- FONCTIONS DE GESTION DES VOTES ---

// Fonction pour vérifier si un ban date de moins de 3 mois
function isBanLessThan3Months(banDateString) {
  // Parse la date au format "DD/MM/YYYY" ou d'autres formats courants
  const banDate = new Date(banDateString);
  const now = new Date();
  const threeMonthsInMs = 3 * 30 * 24 * 60 * 60 * 1000; // Approximation: 3 mois = 90 jours
  
  if (isNaN(banDate.getTime())) {
    // Si le parsing échoue, on considère que c'est invalide
    console.warn(`Date de ban invalide pour: ${banDateString}`);
    return false;
  }
  
  const timeSinceBan = now - banDate;
  return timeSinceBan < threeMonthsInMs;
}

// Fonction pour lancer un vote de débannissement ou le mettre en attente
async function startDebanVote(interaction, userData, reportContent) {
  const targetChannel = await client.channels.fetch(DEBAN_CHANNEL_ID);
  if (!targetChannel) {
    console.error(`Le salon de débannissement avec l'ID ${DEBAN_CHANNEL_ID} est introuvable.`);
    await interaction.followUp({
      content: 'Votre demande a été soumise, mais le vote n\'a pas pu être lancé (salon introuvable).',
      ephemeral: true
    });
    return;
  }

  // Vérifier si le ban date de moins de 3 mois
  const whenBanned = reportContent.match(/- \*\*Date :\*\* (.+)\n/)?.[1] || userData.whenBanned;
  
  if (isBanLessThan3Months(whenBanned)) {
    // Le ban date de moins de 3 mois, mettre en attente
    const threeMonthsInMs = 3 * 30 * 24 * 60 * 60 * 1000;
    const banDate = new Date(whenBanned);
    const eligibilityDate = new Date(banDate.getTime() + threeMonthsInMs);
    
    pendingDebanRequests[userData.discordId] = {
      userData,
      reportContent,
      banDate: whenBanned,
      submittedAt: new Date().toISOString(),
      eligibilityDate: eligibilityDate.toISOString(),
      status: 'pending'
    };
    savePendingDebanRequests();
    
    await interaction.followUp({
      content: `⏳ Votre demande de débannissement a été mise en attente car votre ban date de moins de 3 mois.\n\nVotre demande sera automatiquement soumise au vote le : **${eligibilityDate.toLocaleDateString('fr-FR')}**\n\nVeuillez patienter jusqu'à cette date.`,
      ephemeral: true
    });
    activeDebanRequests.add(userData.discordId);
    return;
  }

  // Le ban date de plus de 3 mois, lancer le vote immédiatement
  const embed = new EmbedBuilder()
    .setTitle(`Demande de débannissement pour ${userData.discordUsername}`)
    .setDescription(reportContent)
    .addFields(
      { name: 'Oui', value: '0', inline: true },
      { name: 'Non', value: '0', inline: true }
    )
    .setColor('#FFD700');

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
      .setCustomId(`deban_vote_oui_${userData.discordId}`)
      .setLabel('Oui')
      .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
      .setCustomId(`deban_vote_non_${userData.discordId}`)
      .setLabel('Non')
      .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
      .setCustomId(`fin_deban_vote_${userData.discordId}`)
      .setLabel('Fin du Vote')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!targetChannel.permissionsFor(targetChannel.guild.members.me).has(PermissionsBitField.Flags.Administrator))
    );

  debanVotes[userData.discordId] = {
    oui: 0,
    non: 0,
    voters: {},
    messageId: null,
    channelId: DEBAN_CHANNEL_ID,
    originalUserId: userData.discordId,
  };
  saveDebanVotes();

  const sentMessage = await targetChannel.send({
    content: `<@&${MENTION_ROLE_ID}> Nouvelle demande de débannissement !`,
    embeds: [embed],
    components: [row]
  });

  debanVotes[userData.discordId].messageId = sentMessage.id;
  saveDebanVotes();
}

// Fonction pour lancer un vote de candidature pour un modérateur
async function startCandidatureVote(userData, reportContent) {
  const targetChannel = await client.channels.fetch(RECRUITMENT_CHANNEL_ID);
  if (!targetChannel) {
    console.error(`Le salon de candidature avec l'ID ${RECRUITMENT_CHANNEL_ID} est introuvable.`);
    return null;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Candidature pour Modérateur : ${userData.discordUsername}`)
    .setDescription(reportContent)
    .addFields(
      { name: 'Oui', value: '0', inline: true },
      { name: 'Non', value: '0', inline: true }
    )
    .setColor('#00FF00'); // Vert pour les candidatures

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
      .setCustomId(`recrutement_vote_oui_${userData.discordId}`)
      .setLabel('Oui')
      .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
      .setCustomId(`recrutement_vote_non_${userData.discordId}`)
      .setLabel('Non')
      .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
      .setCustomId(`fin_candidature_vote_${userData.discordId}`)
      .setLabel('Fin du Vote')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!targetChannel.permissionsFor(targetChannel.guild.members.me).has(PermissionsBitField.Flags.Administrator))
    );

  candidateVotes[userData.discordId] = {
    oui: 0,
    non: 0,
    voters: {},
    messageId: null,
    channelId: RECRUITMENT_CHANNEL_ID,
    originalUserId: userData.discordId,
  };
  saveCandidateVotes();

  const sentMessage = await targetChannel.send({
    content: `<@&${MENTION_ROLE_ID}> Nouvelle candidature !`,
    embeds: [embed],
    components: [row]
  });

  candidateVotes[userData.discordId].messageId = sentMessage.id;
  saveCandidateVotes();
  return sentMessage;
}

// Fonction pour lancer un vote de promotion (utilisée après un vote de candidature accepté)
async function startPromotionVote(user, channel) {
    const embed = new EmbedBuilder()
      .setTitle(`Vote de promotion pour ${user.username}`)
      .setDescription(`Promotion : **Candidature acceptée**\nVotez pour <@${user.id}> !`)
      .addFields(
        { name: 'Oui', value: '0', inline: true },
        { name: 'Non', value: '0', inline: true }
      )
      .setColor('#00BFFF');
  
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`candid_vote_oui_${user.id}`)
          .setLabel('Oui')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`candid_vote_non_${user.id}`)
          .setLabel('Non')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`fin_candid_vote_${user.id}`)
          .setLabel('Fin du Vote')
          .setStyle(ButtonStyle.Secondary)
      );
  
    await channel.send({ embeds: [embed], components: [row] });
  }

// --- GESTION DES ÉVÉNEMENTS DISCORD ---

// Fonction pour traiter les demandes en attente qui deviennent éligibles
async function processPendingDebanRequests() {
  const now = new Date();
  const eligibleRequests = Object.keys(pendingDebanRequests).filter(userId => {
    const request = pendingDebanRequests[userId];
    return new Date(request.eligibilityDate) <= now;
  });

  for (const userId of eligibleRequests) {
    const request = pendingDebanRequests[userId];
    console.log(`Traitement de la demande en attente de l'utilisateur ${userId} qui devient maintenant éligible.`);
    
    try {
      const targetChannel = await client.channels.fetch(DEBAN_CHANNEL_ID);
      if (!targetChannel) {
        console.error(`Le salon de débannissement est introuvable.`);
        continue;
      }

      // Lancer le vote avec les données stockées
      const userData = request.userData;
      const reportContent = request.reportContent;

      const embed = new EmbedBuilder()
        .setTitle(`Demande de débannissement pour ${userData.discordUsername}`)
        .setDescription(reportContent)
        .addFields(
          { name: 'Oui', value: '0', inline: true },
          { name: 'Non', value: '0', inline: true },
          { name: '⏳ Statut', value: 'Mise en attente expirée - Vote lancé', inline: false }
        )
        .setColor('#FFD700');

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
          .setCustomId(`deban_vote_oui_${userData.discordId}`)
          .setLabel('Oui')
          .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
          .setCustomId(`deban_vote_non_${userData.discordId}`)
          .setLabel('Non')
          .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
          .setCustomId(`fin_deban_vote_${userData.discordId}`)
          .setLabel('Fin du Vote')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!targetChannel.permissionsFor(targetChannel.guild.members.me).has(PermissionsBitField.Flags.Administrator))
        );

      debanVotes[userData.discordId] = {
        oui: 0,
        non: 0,
        voters: {},
        messageId: null,
        channelId: DEBAN_CHANNEL_ID,
        originalUserId: userData.discordId,
      };
      saveDebanVotes();

      const sentMessage = await targetChannel.send({
        content: `<@&${MENTION_ROLE_ID}> Demande de débannissement mise en attente (délai de 3 mois atteint) !`,
        embeds: [embed],
        components: [row]
      });

      debanVotes[userData.discordId].messageId = sentMessage.id;
      saveDebanVotes();

      // Supprimer de la liste des attentes
      delete pendingDebanRequests[userId];
      savePendingDebanRequests();

      console.log(`Vote lancé pour l'utilisateur ${userId} après la période d'attente.`);
    } catch (error) {
      console.error(`Erreur lors du traitement de la demande en attente pour ${userId}:`, error);
    }
  }
}

client.once(Events.ClientReady, () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
  
  // Traiter les demandes en attente au démarrage
  processPendingDebanRequests();
  
  // Vérifier les demandes en attente toutes les heures
  setInterval(processPendingDebanRequests, 60 * 60 * 1000);
  
  // Mettre à jour le message de recrutement au démarrage du bot
  updateRecruitmentMessage();
});

// Fonction pour mettre à jour le message de recrutement
async function updateRecruitmentMessage() {
  const recruitmentChannel = await client.channels.fetch(RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
  if (!recruitmentChannel) {
    console.error("Le salon de recrutement est introuvable. Impossible de mettre à jour le message.");
    return;
  }

  let messageToEdit;
  try {
    if (!recruitmentState.messageId) {
      throw new Error("ID du message de recrutement non trouvé.");
    }
    messageToEdit = await recruitmentChannel.messages.fetch(recruitmentState.messageId);
  } catch (error) {
    console.error("Message de recrutement non trouvé, création d'un nouveau message.");
    // Si le message n'est pas trouvé, on en crée un nouveau
    const newRecruitmentMessage = await recruitmentChannel.send({
        content: '# Recrutement...',
        embeds: [],
        components: []
    });
    recruitmentState.messageId = newRecruitmentMessage.id;
    saveRecruitmentState();
    messageToEdit = newRecruitmentMessage;
  }
  
  let button;
  let newContent;

  // La condition principale est de savoir si le recrutement est ouvert ET s'il reste des places.
  if (recruitmentState.open && recruitmentState.places > 0) {
    newContent = `# Recrutement ouvert, il y a **${recruitmentState.places}** place(s) disponible(s).`;
    button = new ButtonBuilder()
      .setCustomId('launch_recruitment_form')
      .setLabel('Postuler')
      .setStyle(ButtonStyle.Success);
  } else {
    // Si le recrutement est fermé ou si le nombre de places est tombé à 0, on ferme.
    if (recruitmentState.open && recruitmentState.places <= 0) {
        recruitmentState.open = false;
        saveRecruitmentState();
    }
    newContent = `# Recrutement fermé.`;
    button = new ButtonBuilder()
      .setCustomId('launch_recruitment_form')
      .setLabel('Postuler')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true);
  }

  const row = new ActionRowBuilder().addComponents(button);
  await messageToEdit.edit({ content: newContent, embeds: [], components: [row] });
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // --- GESTION DES COMMANDES SLASH ---
    if (interaction.isChatInputCommand()) {
      // Commande /panel (inchangée)
      if (interaction.commandName === 'panel') {
        if (interaction.guildId !== GUILD_ID) return;
        const embed = new EmbedBuilder()
          .setTitle("Formulaire de débannissement")
          .setDescription("Ceci est le formulaire afin de vous faire débannir.");
        const button = new ButtonBuilder()
          .setCustomId('launch_form')
          .setLabel('Lancer le formulaire')
          .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(button);
        await interaction.reply({ embeds: [embed], components: [row] });
        return;
      }

      // NOUVELLE COMMANDE /recrutement
      if (interaction.commandName === 'recrutement') {
        // Vérification des permissions
        const userRolesPoints = interaction.member.roles.cache.reduce((max, role) => {
          return Math.max(max, rolesPoints[role.id] !== undefined ? rolesPoints[role.id] : 0);
        }, 0);
        const requiredPoints = rolesPoints["1323241034855223348"]; // Points pour le rôle "superviseur"
        if (userRolesPoints < requiredPoints) {
          await interaction.reply({
            content: "Vous n'avez pas la permission de gérer le recrutement.",
            ephemeral: true
          });
          return;
        }

        const type = interaction.options.getString('type');
        const places = interaction.options.getInteger('places');

        if (type === 'ouvrir') {
          if (!places) {
            await interaction.reply({ content: 'Veuillez spécifier le nombre de places pour ouvrir le recrutement.', ephemeral: true });
            return;
          }
          recruitmentState.open = true;
          recruitmentState.places = places;
          saveRecruitmentState();
          await updateRecruitmentMessage();
          await interaction.reply({ content: `Recrutement ouvert avec ${places} place(s) disponible(s).`, ephemeral: true });
        } else if (type === 'fermer') {
          recruitmentState.open = false;
          recruitmentState.places = 0;
          saveRecruitmentState();
          await updateRecruitmentMessage();
          await interaction.reply({ content: "Recrutement fermé.", ephemeral: true });
        }
        return;
      }
    }

    // --- GESTION DES INTERACTIONS BOUTONS ---
    if (interaction.isButton()) {
      // Bouton "Lancer le formulaire de débannissement" (inchangée)
      if (interaction.customId === 'launch_form') {
        if (activeDebanRequests.has(interaction.user.id)) {
          await interaction.reply({
            content: "Vous avez déjà une demande de débannissement en cours. Veuillez attendre la fin de votre demande actuelle.",
            ephemeral: true
          });
          return;
        }
        const debanGuild = await client.guilds.fetch(DEBAN_GUILD_ID).catch(err => {
          console.error(`Erreur lors de la récupération du serveur de débannissement (${DEBAN_GUILD_ID}):`, err);
          return null;
        });
        if (!debanGuild) {
          await interaction.reply({
            content: 'Une erreur est survenue lors de la vérification du serveur de débannissement.',
            ephemeral: true
          });
          return;
        }
        try {
          await debanGuild.bans.fetch(interaction.user.id);
          const modal = new ModalBuilder()
            .setCustomId('form_step1')
            .setTitle('Débannissement - Étape 1');
          const whyBanned = new TextInputBuilder()
            .setCustomId('whyBanned')
            .setLabel('Raison bannissement ?')
            .setPlaceholder("Expliquez brièvement pourquoi vous avez été banni.")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(4000)
            .setRequired(true);
          const whenBanned = new TextInputBuilder()
            .setCustomId('whenBanned')
            .setLabel('Quand banni ?')
            .setPlaceholder("Exemple : 15/08/2022")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true);
          const whoBanned = new TextInputBuilder()
            .setCustomId('whoBanned')
            .setLabel('Qui a banni ?')
            .setPlaceholder("Indiquez le modérateur, le cas échéant.")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(false);
          modal.addComponents(
            new ActionRowBuilder().addComponents(whyBanned),
            new ActionRowBuilder().addComponents(whenBanned),
            new ActionRowBuilder().addComponents(whoBanned)
          );
          await interaction.showModal(modal);
        } catch (error) {
          if (error.code === 10026) {
            await interaction.reply({
              content: "Vous ne vous êtes pas fait bannir définitivement, veuillez rejoindre le serveur principal via le lien ci-dessous\n\nhttps://discord.gg/blzstarss-1097110036192448656.\nVous vous êtes réellement fait bannir du serveur principal ?\nDans ce cas, veuillez contacter un modérateur ou un administrateur du serveur.",
              ephemeral: true
            });
          } else {
            console.error(`Erreur lors de la vérification du bannissement pour ${interaction.user.id}:`, error);
            await interaction.reply({
              content: 'Une erreur est survenue lors de la vérification de votre statut de bannissement.',
              ephemeral: true
            });
          }
          return;
        }
        return;
      }

      // Bouton pour passer à l'étape 2
      if (interaction.customId === 'continue_step2') {
        const modal = new ModalBuilder()
          .setCustomId('form_step2')
          .setTitle('Débannissement - Étape 2');

        const readRules = new TextInputBuilder()
          .setCustomId('readRules')
          .setLabel('Règles comprises ?')
          .setPlaceholder("Répondez par Oui ou Non.")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true);
        const brokenRule = new TextInputBuilder()
          .setCustomId('brokenRule')
          .setLabel('Règle enfreinte ?')
          .setPlaceholder("Ex : Langage inapproprié.")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true);
        const whyUnban = new TextInputBuilder()
          .setCustomId('whyUnban')
          .setLabel('Pourquoi débanni ?')
          .setPlaceholder("Expliquez pourquoi vous méritez d'être débanni.")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true);
        const lessonLearned = new TextInputBuilder()
          .setCustomId('lessonLearned')
          .setLabel('Leçon apprise ?')
          .setPlaceholder("Que retenez-vous de cette expérience ?")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true);
        const avoidRepeat = new TextInputBuilder()
          .setCustomId('avoidRepeat')
          .setLabel('Prévention future ?')
          .setPlaceholder("Comment éviterez-vous cela à l'avenir ?")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(readRules),
          new ActionRowBuilder().addComponents(brokenRule),
          new ActionRowBuilder().addComponents(whyUnban),
          new ActionRowBuilder().addComponents(lessonLearned),
          new ActionRowBuilder().addComponents(avoidRepeat)
        );

        await interaction.showModal(modal);
        return;
      }

      // Bouton pour passer à l'étape 3
      if (interaction.customId === 'continue_step3') {
        const modal = new ModalBuilder()
          .setCustomId('form_step3')
          .setTitle('Débannissement - Étape 3');

        const contribution = new TextInputBuilder()
          .setCustomId('contribution')
          .setLabel('Contribution future ?')
          .setPlaceholder("Comment contribuerez-vous positivement ?")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true);
        const objectives = new TextInputBuilder()
          .setCustomId('objectives')
          .setLabel('Vos objectifs ?')
          .setPlaceholder("Quels sont vos projets en repartant ?")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true);
        const additionalInfo = new TextInputBuilder()
          .setCustomId('additionalInfo')
          .setLabel('Infos suppl. ?')
          .setPlaceholder("Ajoutez toute info complémentaire si besoin.")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(contribution),
          new ActionRowBuilder().addComponents(objectives),
          new ActionRowBuilder().addComponents(additionalInfo)
        );

        await interaction.showModal(modal);
        return;
      }

      // NOUVEAU BOUTON "Postuler"
      if (interaction.customId === 'launch_recruitment_form') {
        const member = interaction.member;

        // Vérification des conditions
        const joinDate = member.joinedAt;
        const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;
        const hasBeenOneWeek = (new Date() - joinDate) > oneWeekInMs;

        // NOTE : La vérification du nombre de messages n'est pas possible directement.
        // Vous devrez implémenter un système de comptage de messages externe (par exemple, dans une base de données).
        // Pour l'instant, nous n'incluons que la vérification de la date de jointure.
        let hasSent100Messages = true; // Placeholder, suppose que la condition est remplie.
        
        let conditionsMet = true;
        let errorMessage = "Vous ne remplissez pas les conditions pour postuler :\n";
        
        if (!hasBeenOneWeek) {
            conditionsMet = false;
            errorMessage += "- Vous devez être sur le serveur depuis plus d'une semaine.\n";
        }
        if (!hasSent100Messages) {
            conditionsMet = false;
            errorMessage += "- Vous devez avoir envoyé au moins 100 messages (vérification non implémentée).\n";
        }
        
        if (!conditionsMet) {
          await interaction.reply({ content: errorMessage, ephemeral: true });
          return;
        }

        // Création du formulaire de candidature - Étape 1
        const modal = new ModalBuilder()
          .setCustomId('moderation_form_step1')
          .setTitle('Candidature Modérateur - 1/2');

        const a2fSelect = new StringSelectMenuBuilder()
          .setCustomId('a2f')
          .setPlaceholder('Avez-vous l\'A2F ?')
          .setRequired(true)
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel('Oui')
              .setValue('Oui'),
            new StringSelectMenuOptionBuilder()
              .setLabel('Non')
              .setValue('Non')
          );
        
        const ageSelect = new StringSelectMenuBuilder()
          .setCustomId('age')
          .setPlaceholder('Avez-vous 13 ans ou + ?')
          .setRequired(true)
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel('Oui')
              .setValue('Oui'),
            new StringSelectMenuOptionBuilder()
              .setLabel('Non')
              .setValue('Non')
          );
        
        const qualitiesDefects = new TextInputBuilder()
          .setCustomId('qualitiesDefects')
          .setPlaceholder('Soyez détaillé.')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        modal.addLabelComponents(
          new LabelBuilder()
            .setLabel('Avez-vous l\'A2F ?')
            .setStringSelectMenuComponent(a2fSelect),
          new LabelBuilder()
            .setLabel('Avez-vous 13 ans ou + ?')
            .setStringSelectMenuComponent(ageSelect),
          new LabelBuilder()
            .setLabel('Qualités et défauts ?')
            .setTextInputComponent(qualitiesDefects)
        );

        await interaction.showModal(modal);
        return;
      }

      // Gestion des boutons de vote de débannissement (inchangée)
      if (interaction.customId.startsWith('deban_vote_oui_') || interaction.customId.startsWith('deban_vote_non_') || interaction.customId.startsWith('fin_deban_vote_')) {
        const parts = interaction.customId.split('_');
        const actionType = parts[2];
        const targetUserId = parts[3];

        let debanmentVote = debanVotes[targetUserId];

        if (!debanmentVote) {
          await interaction.reply({ content: "Ce vote de débannissement n'est plus actif.", ephemeral: true });
          return;
        }

        const voterRolePoints = interaction.member.roles.cache.reduce((max, role) => {
          return Math.max(max, rolesPoints[role.id] !== undefined ? rolesPoints[role.id] : 0);
        }, 0);

        if (voterRolePoints === 0 && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({
            content: "Vous n'avez pas la permission de voter pour le débannissement (rôle insuffisant).",
            ephemeral: true,
          });
          return;
        }

        if (actionType === 'oui' || actionType === 'non') {
          const voteType = actionType;
          const oppositeVoteType = voteType === 'oui' ? 'non' : 'oui';
          const voterId = interaction.user.id;
          let message;

          if (debanmentVote.voters[voterId]) {
            if (debanmentVote.voters[voterId] === voteType) {
              debanmentVote[voteType] -= voterRolePoints;
              delete debanmentVote.voters[voterId];
              message = `Votre vote pour "${voteType}" a été annulé.`;
            } else {
              debanmentVote[oppositeVoteType] -= voterRolePoints;
              debanmentVote[voteType] += voterRolePoints;
              debanmentVote.voters[voterId] = voteType;
              message = `Votre vote a été mis à jour pour "${voteType}".`;
            }
          } else {
            debanmentVote[voteType] += voterRolePoints;
            debanmentVote.voters[voterId] = voteType;
            message = `Votre vote pour "${voteType}" a été enregistré.`;
          }

          saveDebanVotes();

          const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setFields(
              { name: 'Oui', value: `${debanmentVote.oui}`, inline: true },
              { name: 'Non', value: `${debanmentVote.non}`, inline: true }
            );

          await interaction.update({
            embeds: [updatedEmbed],
            components: interaction.message.components,
          });

          await interaction.followUp({
            content: message,
            ephemeral: true
          });

        } else if (actionType === 'vote') {
          await interaction.deferUpdate();
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.followUp({
              content: "Vous n'avez pas la permission de terminer ce vote.",
              ephemeral: true,
            });
            return;
          }

          const channel = interaction.channel;
          const totalOui = debanmentVote.oui;
          const totalNon = debanmentVote.non;
          let finalResultMessage;

          if (totalOui > totalNon) {
            finalResultMessage = `<@${targetUserId}> a été **accepté** pour le débannissement avec ${totalOui} voix pour et ${totalNon} voix contre.`;
            try {
              const debanGuild = await client.guilds.fetch(DEBAN_GUILD_ID);
              await debanGuild.bans.remove(targetUserId, 'Débanni via vote accepté');
              console.log(`Utilisateur ${targetUserId} débanni du serveur ${DEBAN_GUILD_ID}`);
            } catch (unbanError) {
              console.error(`Erreur lors du débannissement de l'utilisateur ${targetUserId}:`, unbanError);
              finalResultMessage += "\nUne erreur est survenue lors de la tentative de débannissement automatique.";
            }
          } else if (totalOui < totalNon) {
            finalResultMessage = `<@${targetUserId}> a été **refusé** pour le débannissement avec ${totalOui} voix pour et ${totalNon} voix contre.`;
            try {
              const userToDm = await client.users.fetch(targetUserId);
              await userToDm.send('Bonjour,\nVotre demande de débannissement a été refusée.');
              console.log(`MP envoyé à ${targetUserId} pour refus de débannissement.`);
            } catch (dmError) {
              console.error(`Erreur lors de l'envoi du MP à ${targetUserId}:`, dmError);
              finalResultMessage += "\nUne erreur est survenue lors de l'envoi du message privé.";
            }
          } else {
            finalResultMessage = `Le vote pour <@${targetUserId}> est **à égalité** avec ${totalOui} voix pour et ${totalNon} voix contre.`;
          }

          await channel.send(finalResultMessage);

          const disabledRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
              .setCustomId(`deban_vote_oui_${targetUserId}`)
              .setLabel('Oui')
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
              new ButtonBuilder()
              .setCustomId(`deban_vote_non_${targetUserId}`)
              .setLabel('Non')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true),
              new ButtonBuilder()
              .setCustomId(`fin_deban_vote_${targetUserId}`)
              .setLabel('Fin du Vote')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
            );

          await interaction.message.edit({
            components: [disabledRow]
          });
          activeDebanRequests.delete(targetUserId);
          delete debanVotes[targetUserId];
          saveDebanVotes();
          await interaction.followUp({
            content: `Le vote de débannissement pour <@${targetUserId}> est terminé.`,
            ephemeral: true
          });
        }
        return;
      }

      // NOUVELLE GESTION DES BOUTONS DE VOTE DE CANDIDATURE
      if (interaction.customId.startsWith('recrutement_vote_oui_') || interaction.customId.startsWith('recrutement_vote_non_') || interaction.customId.startsWith('fin_candidature_vote_') || interaction.customId === 'continue_moderation_step2') {
        if (interaction.customId === 'continue_moderation_step2') {
            const modal = new ModalBuilder()
                .setCustomId('moderation_form_step2')
                .setTitle('Candidature Modérateur - 2/2');

            const whyYou = new TextInputBuilder()
                .setCustomId('whyYou')
                .setPlaceholder('Pourquoi vous et pas quelqu\'un d\'autre ?')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const motivation = new TextInputBuilder()
                .setCustomId('motivation')
                .setPlaceholder('Vos motivations et vos buts.')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const modExperience = new TextInputBuilder()
                .setCustomId('modExperience')
                .setPlaceholder('Nom du serveur et nombre de membres.')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            modal.addLabelComponents(
                new LabelBuilder()
                    .setLabel('Expérience en modération ?')
                    .setDescription('Donnez le nom du serveur et son nombre de membres si applicable.')
                    .setTextInputComponent(modExperience),
                new LabelBuilder()
                    .setLabel('Pourquoi vous ?')
                    .setDescription('Expliquez ce qui vous différencie.')
                    .setTextInputComponent(whyYou),
                new LabelBuilder()
                    .setLabel('Pourquoi ce rôle ?')
                    .setDescription('Partagez vos motivations et objectifs.')
                    .setTextInputComponent(motivation)
            );

            await interaction.showModal(modal);
            return;
        }
      
        const parts = interaction.customId.split('_');
        const actionType = parts[2];
        const targetUserId = parts[3];
        const recruitmentVote = candidateVotes[targetUserId];

        if (!recruitmentVote) {
          await interaction.reply({ content: "Ce vote de candidature n'est plus actif.", ephemeral: true });
          return;
        }

        const voterRolePoints = interaction.member.roles.cache.reduce((max, role) => {
          return Math.max(max, rolesPoints[role.id] !== undefined ? rolesPoints[role.id] : 0);
        }, 0);
        
        // Les mêmes conditions de vote que pour le débannissement s'appliquent ici.
        if (voterRolePoints === 0 && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({
              content: "Vous n'avez pas la permission de voter pour cette candidature (rôle insuffisant).",
              ephemeral: true,
          });
          return;
        }

        if (actionType === 'oui' || actionType === 'non') {
            const voteType = actionType;
            const oppositeVoteType = voteType === 'oui' ? 'non' : 'oui';
            const voterId = interaction.user.id;
            let message;

            if (recruitmentVote.voters[voterId]) {
                if (recruitmentVote.voters[voterId] === voteType) {
                    recruitmentVote[voteType] -= voterRolePoints;
                    delete recruitmentVote.voters[voterId];
                    message = `Votre vote pour "${voteType}" a été annulé.`;
                } else {
                    recruitmentVote[oppositeVoteType] -= voterRolePoints;
                    recruitmentVote[voteType] += voterRolePoints;
                    recruitmentVote.voters[voterId] = voteType;
                    message = `Votre vote a été mis à jour pour "${voteType}".`;
                }
            } else {
                recruitmentVote[voteType] += voterRolePoints;
                recruitmentVote.voters[voterId] = voteType;
                message = `Votre vote pour "${voteType}" a été enregistré.`;
            }

            saveCandidateVotes();

            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setFields(
                    { name: 'Oui', value: `${recruitmentVote.oui}`, inline: true },
                    { name: 'Non', value: `${recruitmentVote.non}`, inline: true }
                );

            await interaction.update({
                embeds: [updatedEmbed],
                components: interaction.message.components,
            });

            await interaction.followUp({ content: message, ephemeral: true });

        } else if (actionType === 'vote') {
            await interaction.deferUpdate();

            const totalOui = recruitmentVote.oui;
            const totalNon = recruitmentVote.non;
            let finalResultMessage;

            if (totalOui > totalNon) {
                finalResultMessage = `<@${targetUserId}> a été **accepté** pour la candidature avec ${totalOui} voix pour et ${totalNon} voix contre.`;
                try {
                    const guild = await client.guilds.fetch(DEBAN_GUILD_ID);
                    const member = await guild.members.fetch(targetUserId);
                    if (member) {
                        await member.roles.add(['1323240945235529748', '1172237685763608579']);
                    }
                    const user = await client.users.fetch(targetUserId);
                    await user.send('Félicitations, votre candidature pour le rôle de modérateur a été acceptée.');
                } catch (error) {
                    console.error(`Erreur lors de l'ajout des rôles ou de l'envoi du MP pour ${targetUserId}:`, error);
                    finalResultMessage += "\n⚠️ Erreur lors de l'attribution des rôles ou de l'envoi du message privé.";
                }
                
                // Mise à jour de l'état du recrutement après une acceptation
                recruitmentState.places--;
                saveRecruitmentState();
                updateRecruitmentMessage();

            } else if (totalOui < totalNon) {
                finalResultMessage = `<@${targetUserId}> a été **refusé** pour la candidature avec ${totalOui} voix pour et ${totalNon} voix contre.`;
                try {
                    const userToDm = await client.users.fetch(targetUserId);
                    await userToDm.send('Votre candidature pour le rôle de modérateur a été refusée.');
                } catch (dmError) {
                    console.error(`Erreur lors de l'envoi du MP de refus à ${targetUserId}:`, dmError);
                    finalResultMessage += "\n⚠️ Erreur lors de l'envoi du message privé.";
                }
            } else {
                finalResultMessage = `Le vote pour <@${targetUserId}> est **à égalité** avec ${totalOui} voix pour et ${totalNon} voix contre.`;
            }
            await interaction.channel.send(finalResultMessage);

            const disabledRow = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder().setCustomId(`recrutement_vote_oui_${targetUserId}`).setLabel('Oui').setStyle(ButtonStyle.Success).setDisabled(true),
                  new ButtonBuilder().setCustomId(`recrutement_vote_non_${targetUserId}`).setLabel('Non').setStyle(ButtonStyle.Danger).setDisabled(true),
                  new ButtonBuilder().setCustomId(`fin_candidature_vote_${targetUserId}`).setLabel('Fin du Vote').setStyle(ButtonStyle.Secondary).setDisabled(true)
              );

            await interaction.message.edit({ components: [disabledRow] });
            delete candidateVotes[targetUserId];
            saveCandidateVotes();
            await interaction.followUp({ content: `Le vote de candidature pour <@${targetUserId}> est terminé.`, ephemeral: true });
        }
        return;
      }
    }

    // --- GESTION DES SOUMISSIONS DE MODALS ---
    if (interaction.type === InteractionType.ModalSubmit) {
      // Formulaire de débannissement (inchangée)
      if (interaction.customId === 'form_step1') {
        const whyBanned = interaction.fields.getTextInputValue('whyBanned');
        const whenBanned = interaction.fields.getTextInputValue('whenBanned');
        const whoBanned = interaction.fields.getTextInputValue('whoBanned');
        formData.set(interaction.user.id, {
          whyBanned,
          whenBanned,
          whoBanned,
          discordUsername: interaction.user.username,
          discordId: interaction.user.id,
        });
        const continueBtn = new ButtonBuilder()
          .setCustomId('continue_step2')
          .setLabel("Continuer vers Étape 2")
          .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(continueBtn);
        await interaction.reply({
          content: 'Étape 1 complétée. Cliquez pour passer à l’étape 2.',
          ephemeral: true,
          components: [row]
        });
        return;
      }
      if (interaction.customId === 'form_step2') {
        const readRules = interaction.fields.getTextInputValue('readRules');
        const brokenRule = interaction.fields.getTextInputValue('brokenRule');
        const whyUnban = interaction.fields.getTextInputValue('whyUnban');
        const lessonLearned = interaction.fields.getTextInputValue('lessonLearned');
        const avoidRepeat = interaction.fields.getTextInputValue('avoidRepeat');
        const data = formData.get(interaction.user.id) || {};
        Object.assign(data, {
          readRules,
          brokenRule,
          whyUnban,
          lessonLearned,
          avoidRepeat
        });
        formData.set(interaction.user.id, data);
        const continueBtn = new ButtonBuilder()
          .setCustomId('continue_step3')
          .setLabel("Continuer vers Étape 3")
          .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(continueBtn);
        await interaction.reply({
          content: 'Étape 2 complétée. Cliquez pour passer à l’étape 3.',
          ephemeral: true,
          components: [row]
        });
        return;
      }
      if (interaction.customId === 'form_step3') {
        const contribution = interaction.fields.getTextInputValue('contribution');
        const objectives = interaction.fields.getTextInputValue('objectives');
        const additionalInfo = interaction.fields.getTextInputValue('additionalInfo');
        const data = formData.get(interaction.user.id) || {};
        Object.assign(data, {
          contribution,
          objectives,
          additionalInfo
        });
        formData.set(interaction.user.id, data);
        const report =
          `**Demande de débannissement**\n\n` +
          `**Contexte du bannissement :**\n` +
          `- **Raison :** ${data.whyBanned}\n` +
          `- **Date :** ${data.whenBanned}\n` +
          `- **Banni par :** ${data.whoBanned || 'Non renseigné'}\n\n` +
          `**Réflexions :**\n` +
          `- **Règles lues :** ${data.readRules}\n` +
          `- **Règle enfreinte :** ${data.brokenRule}\n` +
          `- **Motif débannissement :** ${data.whyUnban}\n` +
          `- **Leçon apprise :** ${data.lessonLearned}\n` +
          `- **Prévention future :** ${data.avoidRepeat}\n\n` +
          `**Engagement futur :**\n` +
          `- **Contribution :** ${data.contribution}\n` +
          `- **Objectifs :** ${data.objectives}\n` +
          `- **Infos complémentaires :** ${data.additionalInfo || 'Aucune'}\n\n` +
          `**Informations utilisateur :**\n` +
          `- **Nom :** ${data.discordUsername}\n` +
          `- **ID :** ${data.discordId}`;
        await startDebanVote(interaction, data, report);
        activeDebanRequests.add(interaction.user.id);
        formData.delete(interaction.user.id);
        await interaction.reply({
          content: 'Votre demande de débannissement a été soumise avec succès et un vote a été lancé.',
          ephemeral: true
        });
        return;
      }

      // NOUVELLE SOUMISSION DE FORMULAIRE DE CANDIDATURE - ÉTAPE 1
      if (interaction.customId === 'moderation_form_step1') {
        const a2fSelection = interaction.fields.getStringSelectValues('a2f');
        const a2f = a2fSelection[0] || 'Non renseigné';
        const ageSelection = interaction.fields.getStringSelectValues('age');
        const age = ageSelection[0] || 'Non renseigné';
        const qualitiesDefects = interaction.fields.getTextInputValue('qualitiesDefects');
        
        formData.set(interaction.user.id, { a2f, age, qualitiesDefects });

        const continueBtn = new ButtonBuilder()
          .setCustomId('continue_moderation_step2')
          .setLabel("Continuer vers étape 2")
          .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(continueBtn);

        await interaction.reply({
          content: 'Étape 1 complétée. Cliquez pour passer à l’étape 2.',
          ephemeral: true,
          components: [row]
        });
        return;
      }

      // NOUVELLE SOUMISSION DE FORMULAIRE DE CANDIDATURE - ÉTAPE 2
      if (interaction.customId === 'moderation_form_step2') {
        const modExperience = interaction.fields.getTextInputValue('modExperience');
        
        // Preuves optionnelles - pas de récupération complexe, juste "Aucune preuve fournie" par défaut
        let proofsLinks = 'Aucune preuve fournie';

        const whyYou = interaction.fields.getTextInputValue('whyYou');
        const motivation = interaction.fields.getTextInputValue('motivation');
        
        const data = formData.get(interaction.user.id) || {};
        // Assigner la variable 'proofsLinks' qui contient la liste formatée
        Object.assign(data, { modExperience, proofsMod: proofsLinks, whyYou, motivation }); 
        formData.set(interaction.user.id, data);

        const report =
          `**Candidature pour Modérateur**\n\n` +
          `**Informations de base :**\n` +
          `- **A2F :** ${data.a2f}\n` +
          `- **13 ans ou + :** ${data.age}\n` +
          `**Réponses :**\n` +
          `- **Qualités et défauts :**\n${data.qualitiesDefects}\n\n` +
          `- **Expérience en modération :**\n${data.modExperience || 'Non renseigné'}\n\n` +
          `- **Preuves (si ancien modérateur) :**\n${data.proofsMod}\n\n` +
          `- **Pourquoi vous et pas quelqu'un d'autre ?**\n${data.whyYou}\n\n` +
          `- **Pourquoi voulez-vous être modérateur ?**\n${data.motivation}\n\n` +
          `**Informations utilisateur :**\n` +
          `- **Nom :** ${interaction.user.username}\n` +
          `- **ID :** ${interaction.user.id}`;

        
        const userData = {
            discordUsername: interaction.user.username,
            discordId: interaction.user.id,
        };

        // Envoi du message d'avertissement si plus de places disponibles
        const pendingApplications = Object.keys(candidateVotes).length;
        const availablePlaces = recruitmentState.places;

        if (availablePlaces > 0 && pendingApplications >= availablePlaces) {
            const message = `⚠️ Votre candidature a bien été soumise, mais il y a déjà **${pendingApplications}** candidatures en attente. Si les **${availablePlaces}** premières candidatures sont acceptées, la vôtre sera automatiquement refusée.`;
            await interaction.user.send(message).catch(console.error);
        } else if (availablePlaces === 0) {
            const message = `⚠️ Le recrutement est actuellement fermé ou n'a pas de places disponibles. Votre candidature ne sera pas examinée pour le moment.`;
            await interaction.user.send(message).catch(console.error);
        }

        // Lancer le vote de candidature
        await startCandidatureVote(userData, report);
        formData.delete(interaction.user.id);

        await interaction.reply({
          content: 'Votre candidature a été soumise avec succès et un vote a été lancé.',
          ephemeral: true
        });
        return;
      }

      // Bouton pour continuer vers l'étape 2 du formulaire de modération
      if (interaction.customId === 'continue_moderation_step2') {
        const modal = new ModalBuilder()
          .setCustomId('moderation_form_step2')
          .setTitle('Candidature Modérateur - 2/2');

        const proofsUpload = new FileUploadBuilder()
          .setCustomId('proofsMod')
          .setMaxValues(3);

        const proofsLabel = new LabelBuilder()
          .setLabel('Preuves (ancien modérateur) ?')
          .setDescription('Screenshots, certifications, liens, etc. (optionnel - max 3 fichiers)')
          .setFileUploadComponent(proofsUpload);

        const whyYou = new TextInputBuilder()
          .setCustomId('whyYou')
          .setLabel('Pourquoi vous ?')
          .setPlaceholder('Pourquoi vous et pas quelqu\'un d\'autre ?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const motivation = new TextInputBuilder()
          .setCustomId('motivation')
          .setLabel('Pourquoi ce rôle ?')
          .setPlaceholder('Vos motivations et vos buts.')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const modExperience = new TextInputBuilder()
          .setCustomId('modExperience')
          .setLabel('Expérience en modération ?')
          .setPlaceholder('Nom du serveur et nombre de membres.')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addLabelComponents(
          proofsLabel,
          new LabelBuilder()
            .setLabel('Pourquoi vous ?')
            .setDescription('Expliquez ce qui vous différencie.')
            .setTextInputComponent(whyYou),
          new LabelBuilder()
            .setLabel('Pourquoi ce rôle ?')
            .setDescription('Partagez vos motivations et objectifs.')
            .setTextInputComponent(motivation),
          new LabelBuilder()
            .setLabel('Expérience en modération ?')
            .setDescription('Donnez le nom du serveur et son nombre de membres si applicable.')
            .setTextInputComponent(modExperience)
        );

        await interaction.showModal(modal);
        return;
      }
    }
  } catch (err) {
    console.error("Erreur lors du traitement de l'interaction :", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Une erreur est survenue lors du traitement de votre action.',
        ephemeral: true
      });
    }
  }
});

client.login(BOT_TOKEN);
