const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("modlog")
    .setDescription(
      "Afficher l'historique des sanctions et des notes d'un membre.",
    )
    .setDefaultMemberPermissions(null)
    .addUserOption((option) =>
      option
        .setName("utilisateur")
        .setDescription("Le membre dont vous voulez voir les sanctions")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Filtrer par type de sanction")
        .setRequired(false)
        .addChoices(
          { name: "🔨 Bans", value: "Ban" },
          { name: "⏳ Time Out", value: "Time Out" },
          { name: "⚠️ Warns", value: "Warn" },
          { name: "👢 Kicks", value: "Kick" },
          { name: "📝 Notes", value: "Note" },
          { name: "🛡️ Warns Staff", value: "Warn Staff" },
          { name: "📋 Tout", value: "all" },
        ),
    )
    .addUserOption((option) =>
      option
        .setName("modérateur")
        .setDescription("Filtrer par modérateur")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("période")
        .setDescription("Filtrer par période")
        .setRequired(false)
        .addChoices(
          { name: "7 derniers jours", value: "7" },
          { name: "30 derniers jours", value: "30" },
          { name: "90 derniers jours", value: "90" },

          { name: "Tout", value: "all" },
        ),
    ),

  async execute(interaction, { dbManager }) {
    const targetUser = interaction.options.getUser("utilisateur");
    const typeFilter = interaction.options.getString("type") || "all";
    const moderatorFilter = interaction.options.getUser("modérateur");
    const periodFilter = interaction.options.getString("période") || "all";

    const sanctionsDb = dbManager.getSanctionsDb();
    const notesDb = dbManager.getNotesDb();
    const rulesDb = dbManager.getRulesDb();
    const staffWarnsDb = dbManager.getStaffWarnsDb();

    // Calculer la date de début selon la période
    const startDate =
      periodFilter === "all"
        ? 0
        : Date.now() - parseInt(periodFilter) * 24 * 60 * 60 * 1000;

    // Promisify DB queries
    const getSanctions = () =>
      new Promise((resolve, reject) => {
        let query = "SELECT * FROM sanctions WHERE userId = ? AND date >= ?";
        const params = [targetUser.id, startDate];

        if (
          typeFilter !== "all" &&
          typeFilter !== "Note" &&
          typeFilter !== "Warn Staff"
        ) {
          query += " AND type = ?";
          params.push(typeFilter);
        }

        if (moderatorFilter) {
          query += " AND moderatorId = ?";
          params.push(moderatorFilter.id);
        }

        query += " ORDER BY date DESC";

        sanctionsDb.all(query, params, (err, rows) =>
          err ? reject(err) : resolve(rows || []),
        );
      });

    const getNotes = () =>
      new Promise((resolve, reject) => {
        // Ne récupérer les notes que si on veut tout ou spécifiquement les notes
        if (typeFilter !== "all" && typeFilter !== "Note") {
          return resolve([]);
        }

        let query = "SELECT * FROM notes WHERE userId = ? AND date >= ?";
        const params = [targetUser.id, startDate];

        if (moderatorFilter) {
          query += " AND moderatorId = ?";
          params.push(moderatorFilter.id);
        }

        query += " ORDER BY date DESC";

        notesDb.all(query, params, (err, rows) =>
          err ? reject(err) : resolve(rows || []),
        );
      });

    const getRules = () =>
      new Promise((resolve, reject) => {
        rulesDb.all("SELECT id, name FROM rules", [], (err, rows) =>
          err ? reject(err) : resolve(rows || []),
        );
      });

    // Compter les totaux pour le résumé
    const getStaffWarns = () =>
      new Promise((resolve, reject) => {
        // Ne récupérer les staffwarns que si on veut tout ou aucun filtre de type sanction
        if (typeFilter !== "all" && typeFilter !== "Warn Staff") {
          return resolve([]);
        }

        let query = "SELECT * FROM staff_warns WHERE userId = ? AND date >= ?";
        const params = [targetUser.id, startDate];

        if (moderatorFilter) {
          query += " AND moderatorId = ?";
          params.push(moderatorFilter.id);
        }

        query += " ORDER BY date DESC";

        staffWarnsDb.all(query, params, (err, rows) =>
          err ? reject(err) : resolve(rows || []),
        );
      });

    const getTotals = () =>
      new Promise((resolve, reject) => {
        sanctionsDb.all(
          "SELECT type, COUNT(*) as count FROM sanctions WHERE userId = ? GROUP BY type",
          [targetUser.id],
          (err, rows) => (err ? reject(err) : resolve(rows || [])),
        );
      });

    try {
      await interaction.deferReply({ ephemeral: true });

      const [sanctions, notes, staffWarns, rules, totals] = await Promise.all([
        getSanctions(),
        getNotes(),
        getStaffWarns(),
        getRules(),
        getTotals(),
      ]);

      if (
        sanctions.length === 0 &&
        notes.length === 0 &&
        staffWarns.length === 0
      ) {
        return interaction.editReply({
          content: `✅ Aucun historique de modération trouvé pour ${targetUser.tag} avec ces filtres.`,
          allowedMentions: { parse: [] },
        });
      }

      // Créer une map des règles pour un accès rapide
      const rulesMap = {};
      rules.forEach((r) => (rulesMap[r.id] = r.name));

      // Associer le nom de la règle aux sanctions
      sanctions.forEach((s) => {
        if (s.rule_id) {
          s.rule_name = rulesMap[s.rule_id];
        }
      });

      // Calculer les totaux par type
      const totalsByType = {};
      totals.forEach((t) => (totalsByType[t.type] = t.count));

      // Fusionner et trier l'historique
      const historique = [
        ...sanctions.map((s) => ({
          type: "sanction",
          sanctionType: s.type,
          date: s.date,
          data: s,
        })),
        ...notes.map((n) => ({
          type: "note",
          sanctionType: "Note",
          date: n.date,
          data: n,
        })),
        ...staffWarns.map((w) => ({
          type: "staffwarn",
          sanctionType: "Warn Staff",
          date: w.date,
          data: w,
        })),
      ].sort((a, b) => b.date - a.date);

      // Pagination
      const itemsParPage = 5;
      const pages = [];
      const publicPages = [];

      for (let i = 0; i < historique.length; i += itemsParPage) {
        const currentPage = historique.slice(i, i + itemsParPage);

        // Construire le container pour cette page
        const container = new ContainerBuilder();

        // Préparer le contenu public textuel de la page
        let publicContent = "";

        // Header avec résumé
        const activeWarns = sanctions.filter(
          (s) => s.type === "Warn" && s.active,
        ).length;
        let riskLevel = "🟢";
        if (activeWarns >= 2 || sanctions.length >= 5) riskLevel = "🟡";
        if (activeWarns >= 3 || sanctions.length >= 10) riskLevel = "🔴";

        const headerContent =
          `# 🗃️ Historique de ${targetUser.tag}\n` +
          `*ID: ${targetUser.id}*\n\n` +
          `${riskLevel} **Résumé:** ` +
          `🔨 ${totalsByType["Ban"] || 0} bans | ` +
          `⏳ ${totalsByType["Time Out"] || 0} mutes | ` +
          `⚠️ ${totalsByType["Warn"] || 0} warns (${activeWarns} actifs) | ` +
          `👢 ${totalsByType["Kick"] || 0} kicks | ` +
          `🛡️ ${staffWarns.length} warns staff`;

        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(headerContent),
        );
        publicContent += headerContent + "\n\n";

        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
        );

        // Ajouter les items de cette page
        currentPage.forEach((item) => {
          const date = new Date(item.date).toLocaleString("fr-FR");

          if (item.type === "sanction") {
            const s = item.data;
            let emoji = "🛡️";
            if (s.type === "Ban") emoji = "🔨";
            if (s.type === "Time Out") emoji = "⏳";
            if (s.type === "Warn") emoji = "⚠️";
            if (s.type === "Kick") emoji = "👢";

            let content = `### ${emoji} ${s.type} — ${date}\n`;
            content += `> **Raison:** ${s.reason || "Aucune"}\n`;

            if (s.type === "Warn") {
              if (s.rule_name) {
                content += `> **Règle:** ${s.rule_name}\n`;
              }
              content += `> **Statut:** ${s.active ? "🔴 Actif" : "🟢 Expiré"}\n`;
            }
            if (s.duration) content += `> **Durée:** ${s.duration}\n`;

            const modId =
              s.moderatorId === "System" ? "Système" : `<@${s.moderatorId}>`;
            content += `> **Modérateur:** ${modId}\n`;
            content += `> **ID:** \`${s.id}\``;

            if (s.pendingDeletion) {
              const deleteDate = new Date(s.deletionDate).toLocaleDateString(
                "fr-FR",
              );
              content += `\n> ⚠️ **SUPPRESSION PROGRAMMÉE** le ${deleteDate}`;
            }

            container.addTextDisplayComponents(
              new TextDisplayBuilder().setContent(content),
            );
            publicContent += content + "\n\n";
          } else if (item.type === "note") {
            const n = item.data;
            const modId = `<@${n.moderatorId}>`;
            const content =
              `### 📝 Note — ${date}\n` +
              `> **Contenu:** ${n.note}\n` +
              `> **Par:** ${modId}\n` +
              `> **ID:** \`${n.id}\``;

            container.addTextDisplayComponents(
              new TextDisplayBuilder().setContent(content),
            );
            publicContent += content + "\n\n";
          } else if (item.type === "staffwarn") {
            const w = item.data;
            const modId = `<@${w.moderatorId}>`;
            const content =
              `### 🛡️ Warn Staff — ${date}\n` +
              `> **Raison:** ${w.reason}\n` +
              `> **Modérateur:** ${modId}\n` +
              `> **ID:** \`${w.id}\``;

            container.addTextDisplayComponents(
              new TextDisplayBuilder().setContent(content),
            );
            publicContent += content + "\n\n";
          }

          container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
          );
        });

        // Footer avec pagination
        const footer = `*Page ${pages.length + 1} — ${historique.length} élément(s) au total*`;
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(footer),
        );
        publicContent += footer;

        pages.push(container);
        publicPages.push(publicContent);
      }

      // Créer les boutons de navigation
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("modlog_prev")
          .setLabel("◀️ Précédent")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("modlog_next")
          .setLabel("Suivant ▶️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pages.length <= 1),
        new ButtonBuilder()
          .setCustomId("modlog_send_public")
          .setLabel("Envoyer publiquement")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false),
      );

      const response = await interaction.editReply({
        components: [pages[0], row],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000,
      });

      let currentPageIdx = 0;

      collector.on("collect", async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({
            content: "Ce menu ne vous est pas destiné.",
            ephemeral: true,
          });
        }

        if (i.customId === "modlog_prev") currentPageIdx--;
        if (i.customId === "modlog_next") currentPageIdx++;

        if (i.customId === "modlog_send_public") {
          try {
            const publicContainer = pages[currentPageIdx];
            const senderRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("sent_by")
                .setLabel(`Envoyé par : ${interaction.user.tag}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            );

            const sentMsg = await interaction.channel.send({
              components: [publicContainer.toJSON(), senderRow.toJSON()],
              flags: MessageFlags.IsComponentsV2,
              allowedMentions: { parse: [] },
            });
            const link = `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${sentMsg.id}`;
            await i.reply({
              content: `Message [envoyé](${link}) publiquement.`,
              ephemeral: true,
            });
          } catch (err) {
            console.error("Erreur en envoyant publiquement :", err);
            await i.reply({
              content: "Erreur lors de l'envoi public.",
              ephemeral: true,
            });
          }
          return;
        }

        row.components[0].setDisabled(currentPageIdx === 0);
        row.components[1].setDisabled(currentPageIdx === pages.length - 1);

        await i.update({
          components: [pages[currentPageIdx], row],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] },
        });
      });

      collector.on("end", () => {
        row.components.forEach((b) => b.setDisabled(true));
        response
          .edit({
            components: [pages[currentPageIdx], row],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
          })
          .catch(() => {});
      });
    } catch (error) {
      console.error("Erreur modlog:", error);
      const content =
        "❌ Une erreur est survenue lors de la récupération des logs.";
      if (interaction.deferred) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  },
};
