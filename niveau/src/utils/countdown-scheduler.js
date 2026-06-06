const logger = require('./logger');
const store = require('./countdown-store');
const { postOrRefreshCountdown } = require('./countdown-poster');

const REFRESH_MS = Math.max(
    3_600_000,
    parseInt(process.env.BLZ_COUNTDOWN_REFRESH_MS || String(6 * 3_600_000), 10),
);

let timer = null;

async function refreshAllCountdowns(client) {
    const rows = store.listAllActive().filter((r) => r.channel_id && r.message_id);
    if (!rows.length) return;
    let ok = 0;
    let err = 0;
    for (const r of rows) {
        try {
            await postOrRefreshCountdown(client, {
                id: r.id,
                title: r.title,
                subtitle: r.subtitle,
                targetMs: r.target_ms,
                guildId: r.guild_id,
                channelId: r.channel_id,
                messageId: r.message_id,
            });
            ok++;
        } catch (e) {
            err++;
            logger.warn(`[countdown] refresh #${r.id}:`, e?.message || e);
        }
    }
    if (ok || err) {
        logger.info(`[countdown] Rafraîchi ${ok}/${rows.length} message(s)${err ? ` (${err} err)` : ''}.`);
    }
}

function startCountdownScheduler(client) {
    if (timer) return;
    const tick = () => {
        refreshAllCountdowns(client).catch((e) =>
            logger.error('[countdown] scheduler:', e?.message || e),
        );
    };
    setTimeout(tick, 120_000);
    timer = setInterval(tick, REFRESH_MS);
    logger.info(`[countdown] Scheduler actif (toutes les ${Math.round(REFRESH_MS / 3_600_000)} h).`);
}

module.exports = { startCountdownScheduler, refreshAllCountdowns };
