const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  getEventState,
  grantEventCurrency,
  getOrCreateEventUser,
  db,
} = require("../../utils/db-valentin");
const logger = require("../../utils/logger");
const { parisDateKey } = require("../../../../utils/paris-time");

// Configuration du jeu
const DATE_ITEMS = [
  { id: "date_eau", name: "Eau du robinet", price: 10, emoji: "🚰" },
  { id: "date_vin", name: "Vin de table", price: 30, emoji: "🍷" },
  { id: "date_tacos", name: "Tacos 3 viandes", price: 50, emoji: "🌯" },
  { id: "date_caviar", name: "Caviar", price: 70, emoji: "🐟" },
  { id: "date_dessert", name: "Dessert maison", price: 40, emoji: "🍰" },
];

const INITIAL_MONEY = 50;
const WIN_REWARD = 200;
const DAILY_WIN_LIMIT = 5;
const HEIST_BASE_REWARD = 50;
const HEIST_STEP_LOSS = 15;

// Table pour tracker les wins quotidiens
try {
  db.exec(`
        CREATE TABLE IF NOT EXISTS date_daily_wins (
            user_id TEXT PRIMARY KEY,
            wins INTEGER NOT NULL DEFAULT 0,
            last_reset TEXT NOT NULL
        )
    `);
} catch (e) {}

function getDailyWins(userId) {
  const today = parisDateKey();
  const row = db
    .prepare("SELECT * FROM date_daily_wins WHERE user_id = ?")
    .get(userId);

  if (!row) {
    db.prepare(
      "INSERT INTO date_daily_wins (user_id, wins, last_reset) VALUES (?, 0, ?)",
    ).run(userId, today);
    return 0;
  }

  if (row.last_reset !== today) {
    db.prepare(
      "UPDATE date_daily_wins SET wins = 0, last_reset = ? WHERE user_id = ?",
    ).run(today, userId);
    return 0;
  }

  return row.wins;
}

function incrementDailyWins(userId) {
  const today = parisDateKey();
  db.prepare(
    `
        INSERT INTO date_daily_wins (user_id, wins, last_reset) VALUES (?, 1, ?)
        ON CONFLICT(user_id) DO UPDATE SET wins = wins + 1, last_reset = ?
    `,
  ).run(userId, today, today);
}

function calculateHeistReward(chosenNumber, goldenNumber) {
  const diff = Math.abs(chosenNumber - goldenNumber);
  return HEIST_BASE_REWARD - diff * HEIST_STEP_LOSS;
}

function generateGameEmbed(gameState, currentTurn) {
  const player = currentTurn === 1 ? gameState.player1 : gameState.player2;
  const playerState = currentTurn === 1 ? gameState.p1State : gameState.p2State;
  const opponentState =
    currentTurn === 1 ? gameState.p2State : gameState.p1State;

  const embed = new EmbedBuilder()
    .setTitle(`🌹 DATE - Tour de ${player.username}`)
    .setColor("#FF69B4")
    .setDescription(
      `**Budget :** ${playerState.money}$\n**Items achetés :** ${playerState.items.length}/5`,
    )
    .addFields(
      {
        name: "🛒 Vos Items",
        value:
          playerState.items.length > 0
            ? playerState.items
                .map(
                  (id) =>
                    DATE_ITEMS.find((i) => i.id === id).emoji +
                    " " +
                    DATE_ITEMS.find((i) => i.id === id).name,
                )
                .join("\n")
            : "*Aucun*",
        inline: true,
      },
      {
        name: "👀 Adversaire",
        value: `${opponentState.items.length}/5 items`,
        inline: true,
      },
    )
    .setFooter({
      text: "Achetez un item, faites un braquage, ou passez votre tour !",
    });

  return embed;
}

function generateActionRow(playerState) {
  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();

  // Boutons items (max 5 par row)
  DATE_ITEMS.forEach((item, index) => {
    const owned = playerState.items.includes(item.id);
    const canAfford = playerState.money >= item.price;

    const btn = new ButtonBuilder()
      .setCustomId(`date_buy_${item.id}`)
      .setLabel(`${item.emoji} ${item.price}$`)
      .setStyle(
        owned
          ? ButtonStyle.Success
          : canAfford
            ? ButtonStyle.Primary
            : ButtonStyle.Secondary,
      )
      .setDisabled(owned || !canAfford);

    if (index < 3) row1.addComponents(btn);
    else row2.addComponents(btn);
  });

  // Bouton braquage (désactivé si déjà fait ce tour)
  row2.addComponents(
    new ButtonBuilder()
      .setCustomId("date_heist")
      .setLabel(playerState.heistDone ? "🔫 Braquage (fait)" : "🔫 Braquage")
      .setStyle(
        playerState.heistDone ? ButtonStyle.Secondary : ButtonStyle.Danger,
      )
      .setDisabled(playerState.heistDone),
  );

  // Bouton passer
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("date_pass")
      .setLabel("⏭️ Passer mon tour")
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("date")
    .setDescription(
      "Défiez quelqu'un dans un DATE ! Premier à acheter 5 items gagne.",
    )
    .addUserOption((option) =>
      option
        .setName("adversaire")
        .setDescription("La personne à défier")
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!getEventState("valentin")) {
      return interaction.reply({
        content: "L'événement Saint-Valentin n'est pas actif.",
        ephemeral: true,
      });
    }

    const challenger = interaction.user;
    const opponent = interaction.options.getUser("adversaire");

    if (challenger.id === opponent.id) {
      return interaction.reply({
        content: "Tu veux te date toi-même ? C'est triste...",
        ephemeral: true,
      });
    }

    if (opponent.bot) {
      return interaction.reply({
        content:
          "Les bots n'ont pas de sentiments (enfin, sauf moi, mais je suis occupé).",
        ephemeral: true,
      });
    }

    // Invitation
    const inviteEmbed = new EmbedBuilder()
      .setTitle("💘 Invitation DATE")
      .setDescription(
        `${challenger} te défie dans un DATE !\n\n*Premier à acheter les 5 items gagne 200 cœurs !*`,
      )
      .setColor("#FF69B4");

    const inviteRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("date_accept")
        .setLabel("Accepter 💝")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("date_decline")
        .setLabel("Refuser 💔")
        .setStyle(ButtonStyle.Danger),
    );

    const inviteMsg = await interaction.reply({
      content: `${opponent}`,
      embeds: [inviteEmbed],
      components: [inviteRow],
      fetchReply: true,
    });

    // Attendre réponse de l'adversaire
    const inviteCollector = inviteMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
      filter: (i) => i.user.id === opponent.id,
    });

    inviteCollector.on("collect", async (i) => {
      if (i.customId === "date_decline") {
        inviteCollector.stop();
        await i.update({
          content: `${opponent} a refusé le DATE. 💔`,
          embeds: [],
          components: [],
        });
        return;
      }

      if (i.customId === "date_accept") {
        inviteCollector.stop();
        await i.deferUpdate();

        // Initialiser la partie
        const gameState = {
          player1: challenger,
          player2: opponent,
          p1State: {
            money: INITIAL_MONEY,
            items: [],
            goldenNumber: Math.floor(Math.random() * 10) + 1,
            heistDone: false,
          },
          p2State: {
            money: INITIAL_MONEY,
            items: [],
            goldenNumber: Math.floor(Math.random() * 10) + 1,
            heistDone: false,
          },
          currentTurn: 1, // 1 = player1, 2 = player2
          gameOver: false,
          winner: null,
        };

        await runGame(interaction, gameState);
      }
    });

    inviteCollector.on("end", (collected, reason) => {
      if (reason === "time" && collected.size === 0) {
        interaction
          .editReply({
            content: "Invitation expirée...",
            embeds: [],
            components: [],
          })
          .catch(() => {});
      }
    });
  },
};

async function runGame(interaction, gameState) {
  const currentPlayer =
    gameState.currentTurn === 1 ? gameState.player1 : gameState.player2;
  const currentState =
    gameState.currentTurn === 1 ? gameState.p1State : gameState.p2State;

  const embed = generateGameEmbed(gameState, gameState.currentTurn);
  const rows = generateActionRow(currentState);

  const gameMsg = await interaction.editReply({
    content: `🎮 C'est au tour de ${currentPlayer} !`,
    embeds: [embed],
    components: rows,
  });

  const collector = gameMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000,
    filter: (i) => i.user.id === currentPlayer.id,
  });

  collector.on("collect", async (i) => {
    // Achat d'item
    if (i.customId.startsWith("date_buy_")) {
      const itemId = i.customId.replace("date_buy_", "");
      const item = DATE_ITEMS.find((x) => x.id === itemId);

      if (
        currentState.money >= item.price &&
        !currentState.items.includes(itemId)
      ) {
        await i.deferUpdate(); // Acknowledge l'interaction
        currentState.money -= item.price;
        currentState.items.push(itemId);

        // Vérifier victoire
        if (currentState.items.length >= 5) {
          collector.stop("win");
          gameState.winner = currentPlayer;
          await handleWin(interaction, gameState);
          return;
        }

        // Passer au joueur suivant
        collector.stop("next");
        currentState.heistDone = false; // Reset pour le prochain tour
        gameState.currentTurn = gameState.currentTurn === 1 ? 2 : 1;
        const nextState =
          gameState.currentTurn === 1 ? gameState.p1State : gameState.p2State;
        nextState.heistDone = false;
        await runGame(interaction, gameState);
      } else {
        await i.reply({
          content: "❌ Impossible d'acheter cet item.",
          ephemeral: true,
        });
      }
      return;
    }

    // Braquage
    if (i.customId === "date_heist") {
      const modal = new ModalBuilder()
        .setCustomId("date_heist_modal")
        .setTitle("🔫 Braquage");

      const input = new TextInputBuilder()
        .setCustomId("heist_number")
        .setLabel("Choisissez un nombre entre 1 et 10")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 7")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await i.showModal(modal);

      try {
        const submission = await i.awaitModalSubmit({
          time: 60000,
          filter: (m) =>
            m.customId === "date_heist_modal" && m.user.id === currentPlayer.id,
        });

        const choice = parseInt(
          submission.fields.getTextInputValue("heist_number"),
        );

        if (isNaN(choice) || choice < 1 || choice > 10) {
          await submission.reply({
            content: "❌ Nombre invalide !",
            ephemeral: true,
          });
          return;
        }

        const reward = calculateHeistReward(choice, currentState.goldenNumber);
        currentState.money = Math.max(0, currentState.money + reward); // Ne peut pas être négatif
        currentState.heistDone = true; // Marquer le braquage comme fait

        let feedback =
          reward > 0
            ? `✅ +${reward}$ !`
            : reward < 0
              ? `❌ ${reward}$ (Le nombre d'or était ${currentState.goldenNumber})`
              : `😐 0$ (Le nombre d'or était ${currentState.goldenNumber})`;

        feedback += `\n💰 Nouveau solde: ${currentState.money}$`;

        // Générer un nouveau nombre d'or pour le prochain braquage
        currentState.goldenNumber = Math.floor(Math.random() * 10) + 1;

        await submission.reply({ content: feedback, ephemeral: true });

        // Rafraîchir l'interface (le tour continue, le joueur peut encore acheter)
        const newEmbed = generateGameEmbed(gameState, gameState.currentTurn);
        const newRows = generateActionRow(currentState);
        await interaction.editReply({
          embeds: [newEmbed],
          components: newRows,
        });
      } catch (err) {
        // Timeout ou erreur
      }
      return;
    }

    // Passer le tour
    if (i.customId === "date_pass") {
      await i.deferUpdate();
      collector.stop("next");
      currentState.heistDone = false; // Reset heist pour le prochain tour
      gameState.currentTurn = gameState.currentTurn === 1 ? 2 : 1;
      // Reset heist du prochain joueur aussi
      const nextState =
        gameState.currentTurn === 1 ? gameState.p1State : gameState.p2State;
      nextState.heistDone = false;
      await runGame(interaction, gameState);
      return;
    }
  });

  collector.on("end", (collected, reason) => {
    if (reason === "time") {
      interaction
        .editReply({
          content: `⏰ ${currentPlayer.username} a pris trop de temps. Partie annulée.`,
          embeds: [],
          components: [],
        })
        .catch(() => {});
    }
  });
}

async function handleWin(interaction, gameState) {
  const winner = gameState.winner;
  const loser =
    gameState.currentTurn === 1 ? gameState.player2 : gameState.player1;

  const dailyWins = getDailyWins(winner.id);
  let rewardMessage = "";

  if (dailyWins < DAILY_WIN_LIMIT) {
    grantEventCurrency(winner.id, { coeurs: WIN_REWARD });
    incrementDailyWins(winner.id);
    rewardMessage = `\n\n🎁 **+${WIN_REWARD} Cœurs** (${dailyWins + 1}/${DAILY_WIN_LIMIT} victoires aujourd'hui)`;
  } else {
    rewardMessage = `\n\n⚠️ Limite quotidienne atteinte (${DAILY_WIN_LIMIT}/${DAILY_WIN_LIMIT}). Pas de récompense.`;
  }

  const winEmbed = new EmbedBuilder()
    .setTitle("🎉 VICTOIRE !")
    .setDescription(
      `${winner} a acheté tous les items et remporte le DATE contre ${loser} !${rewardMessage}`,
    )
    .setColor("#00FF00");

  await interaction.editReply({ embeds: [winEmbed], components: [] });
  logger.info(`DATE: ${winner.username} a battu ${loser.username}`);
}
