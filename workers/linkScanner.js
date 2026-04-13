// linkScanner.js
// Version optimisée pour limiter la consommation de mémoire et de CPU

const { Client, IntentsBitField, PermissionsBitField } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { resolveDotenvPath, PEBBLE_HOST_ENV_PATH } = require(path.join(__dirname, '..', 'blzbot-env.js'));
require('dotenv').config({
    path: resolveDotenvPath(
        path.join(__dirname, '..', '.env'),
        PEBBLE_HOST_ENV_PATH,
        path.join(process.cwd(), '.env')
    ),
    quiet: true,
});

const LOG_FILE = 'link_logs.txt';
// Utilisation d'un write stream pour limiter les opérations disque répétées
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// ------------
// Configuration du cache LRU pour limiter la mémoire
// Seuls les résultats positifs (ex. lien/domain bannis) sont stockés.
// La taille maximale est fixée pour éviter la prolifération de données.
class LRUCache {
  constructor(limit) {
    this.limit = limit;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    // Actualisation de l'ordre d'utilisation
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.limit) {
      // Suppression du premier élément inséré (le moins récemment utilisé)
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }
  has(key) {
    return this.cache.has(key);
  }
  clear() {
    this.cache.clear();
  }
}

const MAX_CACHE_SIZE = 100; // Limite le nombre d'entrées pour ne pas saturer la mémoire
const bannedLinksCache = new LRUCache(MAX_CACHE_SIZE);
const bannedDomainsCache = new LRUCache(MAX_CACHE_SIZE);

// ------------
// Connexion aux bases de données (sanctions, banned links et banned domains)
const dbSanctions = new sqlite3.Database(
  './modération/sanctions.db',
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  err => {
    if (!err) {
      dbSanctions.run(`
        CREATE TABLE IF NOT EXISTS sanctions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId TEXT NOT NULL,
          type TEXT NOT NULL,
          reason TEXT,
          moderatorId TEXT NOT NULL,
          duration TEXT,
          date INTEGER NOT NULL,
          pendingDeletion INTEGER DEFAULT 0,
          deletionReason TEXT,
          deletionModeratorId TEXT,
          deletionDate INTEGER
        )`);
    }
  }
);

const dbBannedLinks = new sqlite3.Database(
  './banned_links.db',
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  err => {
    if (!err) {
      dbBannedLinks.run('CREATE TABLE IF NOT EXISTS banned_links (link TEXT)');
    }
  }
);

const dbBanDomains = new sqlite3.Database(
  './ban_domains.db',
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  err => {
    if (!err) {
      dbBanDomains.run('CREATE TABLE IF NOT EXISTS ban_domains (domain TEXT)', err => {
        if (!err) {
          dbBanDomains.run('CREATE INDEX IF NOT EXISTS idx_ban_domains_domain ON ban_domains(domain)');
        }
      });
    }
  }
);

// Préchargement limité des entrées bannies depuis la DB
function preloadBannedLinks() {
  dbBannedLinks.all('SELECT link FROM banned_links LIMIT ?', [MAX_CACHE_SIZE], (err, rows) => {
    if (!err && rows) {
      rows.forEach(row => {
        bannedLinksCache.set(row.link.trim(), true);
      });
    }
  });
}

function preloadBannedDomains() {
  dbBanDomains.all('SELECT domain FROM ban_domains LIMIT ?', [MAX_CACHE_SIZE], (err, rows) => {
    if (!err && rows) {
      rows.forEach(row => {
        bannedDomainsCache.set(row.domain.trim(), true);
      });
    }
  });
}

// Préchargement au démarrage
preloadBannedLinks();
preloadBannedDomains();

// ------------
// Fonctions de vérification dans la base en cas d'absence dans le cache.
// Seuls les résultats positifs sont alors stockés dans le cache.
function checkBannedLink(link) {
  return new Promise((resolve, reject) => {
    if (bannedLinksCache.has(link)) return resolve(true);
    dbBannedLinks.get('SELECT link FROM banned_links WHERE link = ?', [link], (err, row) => {
      if (err) {
        reject(err);
      } else {
        if (row) {
          bannedLinksCache.set(link, true);
          resolve(true);
        } else {
          resolve(false);
        }
      }
    });
  });
}

function checkBannedDomain(domain) {
  return new Promise((resolve, reject) => {
    if (bannedDomainsCache.has(domain)) return resolve(true);
    dbBanDomains.get('SELECT domain FROM ban_domains WHERE domain = ?', [domain], (err, row) => {
      if (err) {
        reject(err);
      } else {
        if (row) {
          bannedDomainsCache.set(domain, true);
          resolve(true);
        } else {
          resolve(false);
        }
      }
    });
  });
}

// ------------
// Liste de domaines de raccourcisseurs connus (ceux-ci sont toujours rejetés)
const shorteners = [
  'bit.ly',
  'tinyurl.com',
  'goo.gl',
  'is.gd',
  'buff.ly',
  'adf.ly',
  't.co',
  'qptr.ru',
];

// Expression régulière précompilée pour l'extraction des liens dans un texte
const linkRegex = /(https?:\/\/[^\s]+)/gi;
function extractLinks(text) {
  const matches = text.match(linkRegex);
  if (matches) return matches.map(link => decodeURIComponent(link));
  return [];
}

function isShortener(link) {
  try {
    const parsedUrl = new URL(link);
    const hostname = parsedUrl.hostname.toLowerCase().replace('www.', '');
    return shorteners.includes(hostname);
  } catch (error) {
    return false;
  }
}

// ------------
// Fonction pour écrire dans le log via le write stream
function appendLog(entry) {
  const logMessage = `[${new Date().toISOString()}] ${entry}\n`;
  logStream.write(logMessage);
}

// ------------
// Fonction commune pour appliquer la sanction (timeout, log et notification)
async function applySanction(member, reason, link) {
  try {
    await member.timeout(7 * 86400000, `${reason} : ${link}`);
    dbSanctions.run(
      `INSERT INTO sanctions (userId, type, reason, moderatorId, duration, date) VALUES (?, ?, ?, ?, ?, ?)`,
      [member.user.id, 'Time Out', `${reason} : ${link}`, 'System', '1 semaine', Date.now()]
    );
    const channel = client.channels.cache.get(sanctionsLogChannelId);
    if (channel) {
      const malLink = link + ' supprimez.ceci.pour.accéder.au.lien.';
      channel.send(
        `# ${member.user.username} [${member.user.id}] a été mis en time out pendant 1 semaine pour ${reason} (${malLink})`
      );
    }
    await member.send(
      `Vous avez été mis en time out (mute) pour la raison : "${reason}" pendant une durée de 1 semaine.`
    );
  } catch (erreur) {
    console.error(`Erreur lors de l'application de la sanction pour ${reason} :`, erreur);
  }
}

const sanctionsLogChannelId = '1343193683595366482';
const EXEMPT_ROLE_ID = '1172237685763608579'; // L'ID du rôle qui ne doit pas être sanctionné

// ------------
// Initialisation du client Discord
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.DirectMessages,
  ],
  partials: ['CHANNEL', 'GUILD_MEMBER', 'MESSAGE'],
});

client.once('clientReady', () => {
  console.log(`[linkScanner.js] Connecté en tant que ${client.user.tag}`);
});

// ------------
// Gestion des messages
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  let member;
  try {
    // Récupération unique du membre pour limiter les accès redondants
    member = await message.guild.members.fetch(message.author.id);
  } catch (error) {
    console.error('Erreur lors de la récupération du membre:', error);
    return;
  }

  try {
    // --- Gestion de la commande !banlink ---
    if (message.content.startsWith('!banlink')) {
      if (
        !message.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
        !message.member.roles.cache.has('1323241032770654289') &&
        !message.member.roles.cache.has('1323241034855223348')
      ) {
        message.channel.send(
          `${message.author}, vous n'avez pas les permissions nécessaires pour utiliser cette commande.`
        );
        return;
      }

      if (message.reference) {
        const referencedMessage = await message.channel.messages
          .fetch(message.reference.messageId)
          .catch(() => null);
        if (referencedMessage && referencedMessage.content) {
          const links = extractLinks(referencedMessage.content);
          if (links && links.length > 0) {
            for (const link of links) {
              const sanitizedLink = link.trim();
              if (sanitizedLink) {
                dbBannedLinks.run('INSERT INTO banned_links (link) VALUES (?)', [sanitizedLink]);
                // Ajout dans le cache positif (si la limite n'est pas atteinte)
                bannedLinksCache.set(sanitizedLink, true);
              }
            }
            try {
              await referencedMessage.delete();
            } catch (error) {
              console.error('Erreur lors de la suppression du message référencé :', error);
            }
            message.channel.send(
              `${message.author}, lien(s) interdit(s) ajouté(s) et message supprimé.`
            );
          } else {
            message.channel.send(
              `${message.author}, aucun lien valide trouvé dans le message référencé.`
            );
          }
        } else {
          message.channel.send(
            `${message.author}, impossible de trouver le message référencé.`
          );
        }
      } else {
        message.channel.send(
          `${message.author}, veuillez répondre à un message contenant le lien à interdire.`
        );
      }
      return;
    }

    // --- Gestion de la commande !bandom ---
    if (message.content.startsWith('!bandom')) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        message.channel.send(
          `${message.author}, vous n'avez pas les permissions nécessaires pour utiliser cette commande.`
        );
        return;
      }

      if (message.reference) {
        const referencedMessage = await message.channel.messages
          .fetch(message.reference.messageId)
          .catch(() => null);
        if (referencedMessage && referencedMessage.content) {
          const links = extractLinks(referencedMessage.content);
          if (links && links.length > 0) {
            for (const link of links) {
              try {
                const parsedUrl = new URL(link);
                const sanitizedDomain = parsedUrl.hostname.toLowerCase().replace('www.', '').trim();
                if (sanitizedDomain) {
                  dbBanDomains.run('INSERT INTO ban_domains (domain) VALUES (?)', [sanitizedDomain]);
                  bannedDomainsCache.set(sanitizedDomain, true);
                }
              } catch (error) {
                console.error('Erreur lors de l\'analyse du domaine :', error);
              }
            }
            try {
              await referencedMessage.delete();
            } catch (error) {
              console.error('Erreur lors de la suppression du message référencé :', error);
            }
            message.channel.send(
              `${message.author}, domaine(s) interdit(s) ajouté(s) et message supprimé.`
            );
          } else {
            message.channel.send(
              `${message.author}, aucun domaine valide trouvé dans le message référencé.`
            );
          }
        } else {
          message.channel.send(
            `${message.author}, impossible de trouver le message référencé.`
          );
        }
      } else {
        message.channel.send(
          `${message.author}, veuillez répondre à un message contenant le domaine à interdire.`
        );
      }
      return;
    }

    // --- Surveillance et modération des liens dans les messages ---
    const links = extractLinks(message.content);
    if (links && links.length > 0) {
      // Dès qu'une violation est détectée, le traitement s'arrête pour limiter l'usage CPU.
      let violationFound = false;
      for (const link of links) {
        try {
          let parsedUrl;
          try {
            parsedUrl = new URL(link);
          } catch (error) {
            // Si le lien n'est pas une URL valide, on passe au suivant.
            continue;
          }
          const userHostname = parsedUrl.hostname.toLowerCase().replace('www.', '');

          // Vérification des liens "encryptés" (via decodeURIComponent)
          if (link !== decodeURIComponent(link)) {
            if (!violationFound) {
              try {
                await message.delete();
              } catch (error) {
                console.error('Erreur lors de la suppression du message :', error);
              }

              if (member.roles.cache.has(EXEMPT_ROLE_ID)) {
                message.channel.send(
                  `${message.author}, attention ! Le lien que vous avez envoyé (${link}) est considéré comme malveillant (chiffré) et a été supprimé. Vous n'avez pas été sanctionné car vous êtes modérateur`
                );
                appendLog(`Le lien "${link}" est chiffré, mais l'utilisateur ${message.author.tag} (${message.author.id}) n'a pas été sanctionné en raison de son rôle.`);
              } else {
                await applySanction(member, "envoi de liens encryptés", link);
                appendLog(`Le lien "${link}" est encrypté`);
              }
              violationFound = true;
              break;
            }
          }
  
          // Vérification des liens raccourcis
          if (isShortener(link)) {
            if (!violationFound) {
              try {
                await message.delete();
              } catch (error) {
                console.error('Erreur lors de la suppression du message :', error);
              }

              if (member.roles.cache.has(EXEMPT_ROLE_ID)) {
                message.channel.send(
                  `${message.author},attention ! Le lien que vous avez envoyé (${link}) est considéré comme malveillant (chiffré) et a été supprimé. Vous n'avez pas été sanctionné car vous êtes modérateur`
                );
                appendLog(`Le lien "${link}" est un raccourcisseur, mais l'utilisateur ${message.author.tag} (${message.author.id}) n'a pas été sanctionné en raison de son rôle.`);
              } else {
                message.channel.send(
                  `${message.author}, les liens raccourcis sont interdits.`
                );
              }
              violationFound = true;
              break;
            }
          }
  
          // Vérification si le lien figure dans la table des liens interdits
          const bannedLink = await checkBannedLink(link.trim());
          if (bannedLink) {
            if (!violationFound) {
              try {
                await message.delete();
              } catch (error) {
                console.error('Erreur lors de la suppression du message :', error);
              }

              if (member.roles.cache.has(EXEMPT_ROLE_ID)) {
                message.channel.send(
                  `${message.author}, attention ! Le lien que vous avez envoyé (${link}) est considéré comme malveillant (chiffré) et a été supprimé. Vous n'avez pas été sanctionné car vous êtes modérateur`
                );
                appendLog(`Le lien "${link}" est interdit (banned_links), mais l'utilisateur ${message.author.tag} (${message.author.id}) n'a pas été sanctionné en raison de son rôle.`);
              } else {
                await applySanction(member, "envoi d'un lien interdit", link);
                appendLog(`Le lien "${link}" est interdit (banned_links)`);
              }
              violationFound = true;
              break;
            }
          }
  
          // Vérification si le domaine figure dans la table des domaines interdits
          const bannedDomain = await checkBannedDomain(userHostname);
          if (bannedDomain) {
            if (!violationFound) {
              try {
                await message.delete();
              } catch (error) {
                console.error('Erreur lors de la suppression du message :', error);
              }

              if (member.roles.cache.has(EXEMPT_ROLE_ID)) {
                message.channel.send(
                  `${message.author}, attention ! Le lien que vous avez envoyé (${link}) est considéré comme malveillant (chiffré) et a été supprimé. Vous n'avez pas été sanctionné car vous êtes modérateur.`
                );
                appendLog(`Le lien "${link}" contient le domaine interdit "${userHostname}", mais l'utilisateur ${message.author.tag} (${message.author.id}) n'a pas été sanctionné en raison de son rôle.`);
              } else {
                await applySanction(member, "envoi d'un lien avec domaine interdit", link);
                appendLog(`Le lien "${link}" contient le domaine interdit "${userHostname}"`);
              }
              violationFound = true;
              break;
            }
          }
  
        } catch (error) {
          console.error("Erreur lors de l'analyse du lien :", error);
        }
      }
    }
  } catch (erreur) {
    console.error('Erreur lors du traitement du message :', erreur);
  }
});

client.login(process.env.BOT_TOKEN);
