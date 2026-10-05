const db = require("../database/database");
const { ITEMS, SHOP_CONFIG } = require("./items");
const { parisDateKey } = require("../../../utils/paris-time");

/**
 * Crée la table de la boutique dans la base de données si elle n'existe pas.
 */
function initializeShopDatabase() {
  try {
    db.exec(`
            CREATE TABLE IF NOT EXISTS daily_shop (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id TEXT NOT NULL,
                generated_at DATE NOT NULL
            )
        `);
    console.log('Table "daily_shop" vérifiée/créée avec succès.');
  } catch (error) {
    console.error(
      "Erreur lors de la création de la table de la boutique:",
      error,
    );
    throw error; // Propage l'erreur pour que le bot ne démarre pas si la DB échoue
  }
}

/**
 * Sélectionne un item aléatoire en respectant les probabilités de rareté.
 * @returns {string} L'ID de l'item choisi.
 */
function pickRandomItemId() {
  const rotationalItems = Object.values(ITEMS).filter(
    (item) => item.type === "item",
  );
  const itemsByRarity = {};
  for (const item of rotationalItems) {
    if (!itemsByRarity[item.rarity]) {
      itemsByRarity[item.rarity] = [];
    }
    itemsByRarity[item.rarity].push(item.id);
  }

  const rand = Math.random();
  let cumulativeProbability = 0;

  for (const rarity in SHOP_CONFIG.rarityProbabilities) {
    cumulativeProbability += SHOP_CONFIG.rarityProbabilities[rarity];
    if (rand <= cumulativeProbability) {
      const availableItems = itemsByRarity[rarity];
      if (availableItems && availableItems.length > 0) {
        // Pick a random item from that rarity
        const randomIndex = Math.floor(Math.random() * availableItems.length);
        return availableItems[randomIndex];
      }
      // Si aucune item de cette rareté n'est dispo, on continue
    }
  }
  // Fallback au cas où (ne devrait pas arriver si les probas totalisent 1)
  const commonItems = itemsByRarity["Commun"];
  return commonItems[Math.floor(Math.random() * commonItems.length)];
}

/**
 * Génère 4 nouveaux items pour la boutique et les sauvegarde en base de données.
 * @returns {Array<Object>} La liste des 4 nouveaux items.
 */
function generateNewDailyItems() {
  const newItems = new Set();
  // Assurer 4 items uniques
  while (newItems.size < 4) {
    newItems.add(pickRandomItemId());
  }

  const today = parisDateKey();

  const insert = db.prepare(
    "INSERT INTO daily_shop (item_id, generated_at) VALUES (?, ?)",
  );
  const transaction = db.transaction(() => {
    db.exec("DELETE FROM daily_shop"); // Vide la table
    for (const itemId of newItems) {
      insert.run(itemId, today);
    }
  });

  transaction();

  console.log("Nouveaux items de boutique générés:", Array.from(newItems));
  return Array.from(newItems).map((id) => ITEMS[id]);
}

/**
 * Récupère les items du jour de la boutique.
 * Si aucun item n'a été généré aujourd'hui, en génère de nouveaux.
 * @returns {Array<Object>} La liste des 4 items du jour.
 */
function getDailyItems() {
  const today = parisDateKey();
  const itemsFromDb = db
    .prepare("SELECT item_id FROM daily_shop WHERE generated_at = ?")
    .all(today);

  if (itemsFromDb.length === 4) {
    return itemsFromDb.map((row) => ITEMS[row.item_id]);
  } else {
    return generateNewDailyItems();
  }
}

/**
 * Force le rafraîchissement des items de la boutique.
 * @returns {Array<Object>} La nouvelle liste d'items.
 */
function forceRefreshShop() {
  return generateNewDailyItems();
}

module.exports = {
  initializeShopDatabase,
  getDailyItems,
  forceRefreshShop,
};
