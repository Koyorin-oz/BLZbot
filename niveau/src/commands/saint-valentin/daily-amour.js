const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require("discord.js");
const {
  getOrCreateEventUser,
  grantEventCurrency,
  getEventState,
} = require("../../utils/db-valentin");
const logger = require("../../utils/logger");
const {
  parisDayStartMs,
  parisNextMidnightMs,
} = require("../../../../utils/paris-time");

const DAILY_HEARTS = 100;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("daily-amour")
    .setDescription("Réclamez vos 100 Cœurs quotidiens !"),

  async execute(interaction) {
    if (!getEventState("valentin")) {
      return interaction.reply({
        content: "L'événement Saint-Valentin n'est pas actif.",
        ephemeral: true,
      });
    }

    const userId = interaction.user.id;
    const user = getOrCreateEventUser(userId, interaction.user.username);

    const now = Date.now();
    const todayParisStart = parisDayStartMs(now);

    // Vérifier le dernier claim (stocker dans daily_last_claimed ou un champ dédié)
    // Pour simplifier, on utilise un champ séparé dans event_users si besoin
    // Ici on va utiliser un système simple basé sur la date

    const lastClaimKey = `daily_amour_${userId}`;
    const db = require("../../utils/db-valentin").db;

    // Ajouter la colonne si elle n'existe pas
    try {
      db.exec(
        `ALTER TABLE event_users ADD COLUMN daily_amour_last INTEGER DEFAULT 0`,
      );
    } catch (e) {
      // Colonne existe déjà
    }

    const userRow = db
      .prepare("SELECT daily_amour_last FROM event_users WHERE user_id = ?")
      .get(userId);
    const lastClaim = userRow?.daily_amour_last || 0;

    if (lastClaim === 0 || lastClaim < todayParisStart) {
      grantEventCurrency(userId, { coeurs: DAILY_HEARTS });
      db.prepare(
        "UPDATE event_users SET daily_amour_last = ? WHERE user_id = ?",
      ).run(Date.now(), userId);

      const successText = new TextDisplayBuilder().setContent(
        `# 💝 Daily Amour\n\nVoici vos **${DAILY_HEARTS} Cœurs** quotidiens !\n\n*L'amour, c'est tous les jours.* 🥰`,
      );
      const container = new ContainerBuilder().addTextDisplayComponents(
        successText,
      );

      await interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });

      logger.info(`${interaction.user.username} a réclamé son daily-amour.`);
    } else {
      const remainingMs = parisNextMidnightMs(now) - now;

      const hours = Math.floor(remainingMs / (1000 * 60 * 60));
      const minutes = Math.floor(
        (remainingMs % (1000 * 60 * 60)) / (1000 * 60),
      );

      const failText = new TextDisplayBuilder().setContent(
        `# 💔 Patience !\n\nTu as déjà réclamé ton daily aujourd'hui.\nReviens dans **${hours}h ${minutes}m** !`,
      );
      const container = new ContainerBuilder().addTextDisplayComponents(
        failText,
      );

      await interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true,
      });
    }
  },
};
