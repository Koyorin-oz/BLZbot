/**
 * Builders des embeds de log de vérification (matchent les screens fournis) :
 *  - succès vert       : ✅ Vérification Réussie
 *  - alt orange        : 🟠 Compte Alternatif Détecté — Vérification en attente
 *  - VPN/proxy rouge   : 🚫 Vérification Refusée — VPN / Proxy
 *  - échec rouge       : ❌ Vérification Échouée
 *
 * Pour les DM owners on appelle ensuite `withSensitiveFields()` sur l'embed pour
 * y greffer IP brute / email Discord / User-Agent.
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function formatConnexion(geo) {
    if (!geo) return '🌐 Localisation indisponible';
    const flag = geo.flag || '🌐';
    const country = geo.country || 'Inconnu';
    const isp = geo.isp || geo.org || '';
    const tags = [];
    if (geo.mobile) tags.push('📱 mobile');
    if (geo.proxy) tags.push('🛡️ proxy/VPN');
    if (geo.hosting) tags.push('🏢 datacenter');
    const tagSuffix = tags.length ? ` _(${tags.join(' · ')})_` : '';
    return isp ? `${flag} ${country} • ${isp}${tagSuffix}` : `${flag} ${country}${tagSuffix}`;
}

function userField(user, fallbackId) {
    if (!user) return fallbackId ? `<@${fallbackId}>` : '*(inconnu)*';
    const tag = user.username ? `*(${user.username})*` : '';
    return `<@${user.id}>${tag ? `\n${tag}` : ''}`;
}

/**
 * Confiance que c'est bien un alt. Pondère :
 *  - nombre de comptes liés par IP exacte
 *  - récence du dernier match (les matches récents sont beaucoup plus suspects
 *    qu'un match d'il y a un an, qui peut juste être un coloc / un FAI réattribué)
 *  - `mobile: true` → IP partagée par NAT opérateur, baisse la confiance
 *
 * Rendu : { level, emoji, risk (faux positif %), bar (0-10), color (int hex) }
 */
function computeAltConfidence({ alts = [], geo = null, now = Date.now() } = {}) {
    const altCount = alts.length;
    if (altCount === 0) return { level: 'Aucun', emoji: '⚪', risk: 0, bar: 0, color: 0x95a5a6 };

    // Récence : âge en jours du match le plus récent.
    const mostRecent = alts.reduce((acc, a) => Math.max(acc, Number(a.verified_at) || 0), 0);
    const ageDays = mostRecent ? Math.max(0, (now - mostRecent) / (24 * 60 * 60 * 1000)) : 9999;

    // Score de base : plus il y a d'alts, plus on est sûr.
    let score = 0;
    if (altCount >= 5) score = 90;
    else if (altCount >= 3) score = 75;
    else if (altCount >= 2) score = 65;
    else score = 55; // 1 alt seulement : déjà très significatif sur IP exacte

    // Récence : un match dans les 7 jours = +15, dans les 30j = +5, > 6 mois = -15.
    if (ageDays <= 7) score += 15;
    else if (ageDays <= 30) score += 5;
    else if (ageDays > 180) score -= 15;

    // Mobile : NAT opérateur partagé → on retire de la confiance (faux positif réaliste).
    if (geo?.mobile) score -= 25;

    // Hosting / proxy : ça ne devrait jamais arriver ici (verifyServer bloque avant) mais
    // si jamais on relâche cette règle, c'est un signal très fort.
    if (geo?.hosting || geo?.proxy) score += 10;

    score = Math.max(0, Math.min(100, score));

    // Risque de faux positif = 100 - score, borné dans des plages lisibles.
    const fp = Math.max(2, Math.min(60, 100 - score));
    const bar = Math.round((score / 100) * 10);

    let level;
    let emoji;
    let color;
    if (score >= 80) {
        level = 'Très haute';
        emoji = '🔴';
        color = 0xc0392b;
    } else if (score >= 65) {
        level = 'Haute';
        emoji = '🟠';
        color = 0xe67e22;
    } else if (score >= 50) {
        level = 'Moyenne';
        emoji = '🟡';
        color = 0xf1c40f;
    } else {
        level = 'Faible';
        emoji = '🟢';
        color = 0x2ecc71;
    }

    return { level, emoji, risk: fp, bar, color };
}

function progressBar(filled, total = 10) {
    const f = Math.max(0, Math.min(total, filled));
    return `\`[${'█'.repeat(f)}${'░'.repeat(total - f)}]\``;
}

async function buildSuccessEmbed(client, p) {
    const user = await client.users.fetch(p.userId).catch(() => null);
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Vérification Réussie')
        .setDescription(
            "L'utilisateur a passé tous les contrôles de sécurité avec succès. " +
                'Le rôle vérifié lui a été attribué automatiquement.',
        )
        .addFields(
            { name: '👤 Utilisateur', value: userField(user, p.userId), inline: true },
            { name: '🌐 Connexion', value: formatConnexion(p.geo), inline: true },
        )
        .setTimestamp(new Date());
}

/**
 * Embed alt : le rôle n'est PAS attribué automatiquement, un staff doit
 * cliquer le bouton "Vérifier manuellement" rendu par `buildAltActionRow()`.
 */
async function buildAltEmbed(client, p) {
    const user = await client.users.fetch(p.userId).catch(() => null);
    const alts = p.alts || [];
    const conf = computeAltConfidence({ alts, geo: p.geo });
    const altMentions =
        alts
            .slice(0, 20)
            .map((a) => {
                const ts = Number(a.verified_at);
                const tag = Number.isFinite(ts) && ts > 0 ? ` (<t:${Math.floor(ts / 1000)}:R>)` : '';
                return `<@${a.discord_user_id}>${tag}`;
            })
            .join(', ') || '*(aucun)*';

    const fpHint = p.geo?.mobile
        ? '*Faux positif probable : connexion mobile (NAT opérateur partagé entre milliers d’abonnés).*'
        : '*Faux positif possible : membres du même foyer ou appareil partagé.*';

    return new EmbedBuilder()
        .setColor(conf.color)
        .setTitle('🟠 Compte Alternatif Détecté — Vérification en attente')
        .setDescription(
            '⏸️ **Le rôle vérifié n’a PAS été attribué automatiquement.**\n' +
                '🚨 Un compte alternatif probable a été détecté sur ce serveur.\n' +
                '➡️ Un **staff** doit valider manuellement via le bouton ci-dessous.',
        )
        .addFields(
            {
                name: 'Niveau de confiance',
                value: `${conf.emoji} **${conf.level} confiance** — score ${100 - conf.risk}/100`,
                inline: false,
            },
            {
                name: 'Risque de faux positif',
                value: `≈ ${conf.risk}%\n${progressBar(conf.bar)}\n${fpHint}`,
                inline: false,
            },
            { name: '👤 Utilisateur', value: userField(user, p.userId), inline: true },
            { name: '🌐 Connexion', value: formatConnexion(p.geo), inline: true },
            { name: '🔗 Comptes liés', value: altMentions, inline: false },
        )
        .setTimestamp(new Date());
}

/** Row à attacher au message d'alerte alt : bouton "Vérifier manuellement" admin-only. */
function buildAltActionRow(p) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`verify:manual_grant:${p.guildId}:${p.userId}`)
            .setLabel('✅ Vérifier manuellement (staff)')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`verify:manual_reject:${p.guildId}:${p.userId}`)
            .setLabel('🚫 Refuser (alt confirmé)')
            .setStyle(ButtonStyle.Danger),
    );
}

async function buildVpnEmbed(client, p) {
    const user = await client.users.fetch(p.userId).catch(() => null);
    return new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🚫 Vérification Refusée — VPN / Proxy')
        .setDescription(
            '❌ **Vérification bloquée automatiquement.**\n' +
                "Un service VPN ou proxy a été détecté sur la connexion de cet utilisateur.",
        )
        .addFields(
            {
                name: 'Ce que ça signifie',
                value:
                    "Les VPNs permettent de masquer sa vraie identité et d’accéder depuis n’importe quel pays. " +
                    "Ils sont fréquemment utilisés pour contourner des bannissements ou créer des comptes alternatifs indétectables.",
                inline: false,
            },
            {
                name: 'Risque de faux positif : Faible (~10%)',
                value:
                    `${progressBar(1)}\n` +
                    `> Cas possibles : VPN d'entreprise, réseau universitaire, ou détection erronée d'un FAI moins courant.`,
                inline: false,
            },
            { name: '👤 Utilisateur', value: userField(user, p.userId), inline: true },
            { name: '🌐 Connexion', value: formatConnexion(p.geo), inline: true },
        )
        .setTimestamp(new Date());
}

async function buildFailEmbed(client, p) {
    const user = await client.users.fetch(p.userId).catch(() => null);
    const reason = p.reason || 'Raison non précisée.';
    const fields = [
        { name: '👤 Utilisateur', value: userField(user, p.userId), inline: true },
        { name: '🌐 Connexion', value: formatConnexion(p.geo), inline: true },
        { name: 'Détail', value: String(reason).slice(0, 1024), inline: false },
    ];
    if (p.existingUserId) {
        fields.push({
            name: 'Compte déjà lié à cet email',
            value: `<@${p.existingUserId}> (\`${p.existingUserId}\`)`,
            inline: false,
        });
    }
    return new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Vérification Échouée')
        .setDescription(
            "L'utilisateur n'a pas pu valider son compte. Le rôle n'a **pas** été attribué.",
        )
        .addFields(fields)
        .setTimestamp(new Date());
}

/** Greffe IP brute / email / User-Agent pour la version DM owner uniquement. */
function withSensitiveFields(embed, p) {
    const sensitive = [];
    sensitive.push({ name: '🛰️ IP', value: `\`${p.ip || 'inconnue'}\``, inline: true });
    if (p.email) sensitive.push({ name: '📧 Email Discord', value: `\`${p.email}\``, inline: true });
    if (p.userAgent) sensitive.push({ name: '🖥️ User-Agent', value: `\`${String(p.userAgent).slice(0, 200)}\`` });
    embed.addFields(...sensitive);
    return embed;
}

module.exports = {
    buildSuccessEmbed,
    buildAltEmbed,
    buildAltActionRow,
    buildVpnEmbed,
    buildFailEmbed,
    withSensitiveFields,
    computeAltConfidence,
};
