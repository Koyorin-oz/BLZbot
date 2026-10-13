/** Beta Halloween 2026 — constantes. */

const TEST_GUILD_ID = '1493276404643532810';
const MAIN_GUILD_ID = '1097110036192448656';
const PRC_ROLE_ID = '1393152287303663648';

const ROAD = [
    { id: 'd23', date: '2026-10-23', type: 'messages', goal: 50, label: 'Envoyer 50 messages', reward: '500 bonbons' },
    { id: 'd24', date: '2026-10-24', type: 'voice', goal: 30, label: 'Rester 30 min en vocal', reward: '200 citrouilles' },
    { id: 'd25', date: '2026-10-25', type: 'shop', goal: 1, label: 'Acheter un item boutique Halloween', reward: 'x2 EXP 1h' },
    { id: 'd26', date: '2026-10-26', type: 'event', goal: 1, label: 'Participer à un event Halloween', reward: 'x2 starss 1h' },
    { id: 'd27', date: '2026-10-27', type: 'messages', goal: 100, label: 'Envoyer 100 messages', reward: '1 000 bonbons' },
    { id: 'd28', date: '2026-10-28', type: 'messages', goal: 50, label: 'Envoyer 50 messages', reward: '400 citrouilles' },
    { id: 'd29', date: '2026-10-29', type: 'level', goal: 1, label: 'Gagner un niveau', reward: 'x2 EXP 1h' },
    { id: 'd30', date: '2026-10-30', type: 'ghost', goal: 1, label: 'Envoyer un fantôme sur quelqu\'un', reward: 'Collier chasseur de fantômes' },
    { id: 'd31', date: '2026-10-31', type: 'roles', goal: 1, label: 'Avoir Roi des citrouilles ou Roi des bonbons', reward: 'Item Fantôme' },
];

const SHOP = [
    { id: 'role_citrouilles', name: 'Roi des citrouilles', kind: 'role', citrouilles: 3000, bonbons: null },
    { id: 'role_bonbons', name: 'Roi des bonbons', kind: 'role', bonbons: 10000, citrouilles: null },
    { id: 'boost_xp', name: 'Boost x2 EXP (1h)', kind: 'boost_xp', bonbons: 1000, citrouilles: 300 },
    { id: 'boost_stars', name: 'Boost x2 starss (1h)', kind: 'boost_stars', bonbons: 1000, citrouilles: 300 },
    { id: 'item_fantome', name: 'Fantôme (malédiction 2h)', kind: 'item_fantome', bonbons: 3000, citrouilles: 1000 },
    { id: 'item_collier', name: 'Collier chasseur de fantômes (3 charges)', kind: 'item_collier', bonbons: 4500, citrouilles: 1500 },
];

const PHRASES = [
    'le fantôme a volé les bonbons',
    'citrouille rouge sous la lune',
    'blzstarss halloween 2026',
    'pas de morpion la nuit',
    'le collier chasse le fantôme',
];

function parisParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    const o = {};
    for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
    return {
        date: `${o.year}-${o.month}-${o.day}`,
        hour: Number(o.hour),
        minute: Number(o.minute),
    };
}

function shiftDate(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    const p = (n) => String(n).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Quête ouverte de 00:00 le jour J jusqu'à 12:00 le lendemain (Paris). */
function questOpen(quest, now = new Date()) {
    const p = parisParts(now);
    if (p.date === quest.date) return true;
    if (p.date === shiftDate(quest.date, 1) && p.hour < 12) return true;
    return false;
}

function activeQuests(now = new Date()) {
    return ROAD.filter((q) => questOpen(q, now));
}

module.exports = {
    TEST_GUILD_ID,
    MAIN_GUILD_ID,
    PRC_ROLE_ID,
    ROAD,
    SHOP,
    PHRASES,
    parisParts,
    questOpen,
    activeQuests,
};
