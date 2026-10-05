const logger = require("../logger");
const { parisNextMidnightMs } = require("../../../../utils/paris-time");

function msUntilNextMidnightParis() {
  return Math.max(1000, parisNextMidnightMs() - Date.now());
}

function startTreasuryIncomeScheduler(options = {}) {
  const loggerInstance = options.logger || logger;
  const applyDailyIncome =
    options.applyDailyIncome ||
    (() => require("./guild-treasury").applyDailyIncome({ log: true }));
  const catchUpDailyIncome =
    options.catchUpDailyIncome ||
    (() => require("./guild-treasury").catchUpDailyIncome());
  const markDailyIncomeAppliedToday =
    options.markDailyIncomeAppliedToday ||
    (() => require("./guild-treasury").markDailyIncomeAppliedToday());

  const scheduleNextRun = () => {
    const msUntilMidnight = msUntilNextMidnightParis();
    const hoursRemaining = Math.floor(msUntilMidnight / 1000 / 60 / 60);
    const minutesRemaining = Math.floor((msUntilMidnight / 1000 / 60) % 60);

    loggerInstance.info(
      `⏰ Revenu de trésorerie planifié dans ${hoursRemaining}h${minutesRemaining}min (à minuit heure de Paris)`,
    );

    setTimeout(() => {
      loggerInstance.info(
        "🏰 Minuit (Paris) ! Application du revenu de trésorerie des guildes...",
      );
      try {
        catchUpDailyIncome();
        applyDailyIncome();
        markDailyIncomeAppliedToday();
      } catch (error) {
        loggerInstance.error(
          "[treasury-scheduler] Erreur lors de l’application du revenu de trésorerie :",
          error?.message || error,
        );
      }
      scheduleNextRun();
    }, msUntilMidnight);
  };

  try {
    catchUpDailyIncome();
  } catch (error) {
    loggerInstance.error(
      "[treasury-scheduler] Erreur lors du rattrapage initial :",
      error?.message || error,
    );
  }

  scheduleNextRun();
  loggerInstance.info(
    "[treasury-scheduler] Planification du revenu de trésorerie démarrée.",
  );
}

module.exports = { startTreasuryIncomeScheduler, msUntilNextMidnightParis };
