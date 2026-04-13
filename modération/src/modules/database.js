const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const BLZ_COMPACT_DB = process.env.BLZ_COMPACT_LOG === '1';
function dbConnectLog(msg) {
    if (!BLZ_COMPACT_DB) console.log(msg);
}

/**
 * Module de gestion centralisée des bases de données
 */
class DatabaseManager {
    constructor() {
        this.databases = {};
        this.initDatabases();
    }

    /**
     * Calcule le chemin absolu vers le fichier de base de données.
     * Permet de trouver le fichier .db à la racine du dossier 'modération'
     * même si le script est lancé depuis un autre dossier (ex: via PM2 ou script parent).
     */
    getDbPath(dbName) {
        // __dirname = .../src/modules
        // ../../ = remonte à la racine du projet modération
        return path.resolve(__dirname, '../../', dbName);
    }

    initDatabases() {
        // Base de données des sanctions
        this.databases.sanctions = new sqlite3.Database(this.getDbPath('sanctions.db'), sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Erreur lors de la connexion à la base de données des sanctions :', err);
            } else {
                dbConnectLog(`✓ Connecté à la base de données des sanctions.`);
                this.databases.sanctions.serialize(() => {
                    this.databases.sanctions.run(`CREATE TABLE IF NOT EXISTS sanctions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT NOT NULL,
                        type TEXT NOT NULL,
                        reason TEXT,
                        moderatorId TEXT NOT NULL,
                        duration TEXT,
                        date INTEGER NOT NULL,
                        expires_at INTEGER,
                        active INTEGER DEFAULT 1,
                        rule_id INTEGER,
                        pendingDeletion INTEGER DEFAULT 0,
                        deletionReason TEXT,
                        deletionModeratorId TEXT,
                        deletionDate INTEGER,
                        log_message_id TEXT,
                        log_channel_id TEXT
                    )`);
                    this.databases.sanctions.run(`CREATE INDEX IF NOT EXISTS idx_sanctions_userId ON sanctions (userId)`);
                    this.databases.sanctions.run(`CREATE INDEX IF NOT EXISTS idx_sanctions_id ON sanctions (id)`);

                    // Migration pour active
                    this.databases.sanctions.run(`ALTER TABLE sanctions ADD COLUMN active INTEGER DEFAULT 1`, (err) => {
                        if (err && !err.message.includes('duplicate column')) {
                            // Ignore error if column already exists (sqlite doesn't have IF NOT EXISTS for ADD COLUMN in older versions or standard syntax depends on version, but duplicate column error is standard response if it exists)
                            // Actually, checking "duplicate column" is the standard way here as seen in other migrations
                            console.error('Erreur ajout colonne active à sanctions:', err);
                        }
                    });

                    // Migration pour expires_at
                    this.databases.sanctions.run(`ALTER TABLE sanctions ADD COLUMN expires_at INTEGER`, (err) => {
                        if (err && !err.message.includes('duplicate column')) console.error('Erreur ajout colonne expires_at à sanctions:', err);
                    });

                    this.databases.sanctions.run(`CREATE INDEX IF NOT EXISTS idx_sanctions_expires_at ON sanctions (expires_at)`);
                    // Ajouter les colonnes si elles n'existent pas déjà
                    this.databases.sanctions.run(`ALTER TABLE sanctions ADD COLUMN log_message_id TEXT`, (err) => {
                        if (err && !err.message.includes('duplicate column')) console.error('Erreur ajout colonne log_message_id:', err);
                    });
                    this.databases.sanctions.run(`ALTER TABLE sanctions ADD COLUMN log_channel_id TEXT`, (err) => {
                        if (err && !err.message.includes('duplicate column')) console.error('Erreur ajout colonne log_channel_id:', err);
                    });

                    // Migrations supplémentaires pour garantir que toutes les colonnes existent
                    const extraSanctionCols = [
                        { name: 'rule_id', type: 'INTEGER' },
                        { name: 'pendingDeletion', type: 'INTEGER DEFAULT 0' },
                        { name: 'deletionReason', type: 'TEXT' },
                        { name: 'deletionModeratorId', type: 'TEXT' },
                        { name: 'deletionDate', type: 'INTEGER' }
                    ];

                    extraSanctionCols.forEach(col => {
                        this.databases.sanctions.run(`ALTER TABLE sanctions ADD COLUMN deletionsReason TEXT`, (err) => {
                            if (err && !err.message.includes('duplicate column')) {
                                // console.error(`Erreur ajout colonne ${col.name} à sanctions:`, err);
                            }
                        });
                    });

                    // Migration corrective: Désactiver les sanctions marquées pour suppression (fix rétroactif)
                    this.databases.sanctions.run(
                        'UPDATE sanctions SET active = 0 WHERE pendingDeletion = 1 AND active = 1',
                        function (err) {
                            if (err) {
                                console.error('Erreur lors de la désactivation des sanctions pendingDeletion:', err);
                            } else if (this.changes > 0) {
                                console.log(`✅ ${this.changes} sanction(s) en attente de suppression désactivée(s) rétroactivement.`);
                            }
                        }
                    );
                });
            }
        });

        // Base de données des notes
        this.databases.notes = new sqlite3.Database(this.getDbPath('notes.db'), sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Erreur lors de la connexion à la base de données des notes :', err);
            } else {
                dbConnectLog('✓ Connecté à la base de données des notes.');
                this.databases.notes.serialize(() => {
                    this.databases.notes.run(`CREATE TABLE IF NOT EXISTS notes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT NOT NULL,
                        note TEXT NOT NULL,
                        moderatorId TEXT NOT NULL,
                        date INTEGER NOT NULL
                    )`);
                    this.databases.notes.run(`CREATE INDEX IF NOT EXISTS idx_notes_userId ON notes (userId)`);
                    this.databases.notes.run(`CREATE INDEX IF NOT EXISTS idx_notes_id ON notes (id)`);
                });
            }
        });

        // Base de données des règles
        this.databases.rules = new sqlite3.Database(this.getDbPath('rules.db'), sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Erreur lors de la connexion à la base de données des règles :', err);
            } else {
                dbConnectLog('✓ Connecté à la base de données des règles.');
                this.databases.rules.serialize(() => {
                    this.databases.rules.run(`CREATE TABLE IF NOT EXISTS rules (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        description TEXT NOT NULL
                    )`);

                    // Table des règlements complets
                    this.databases.rules.run(`CREATE TABLE IF NOT EXISTS reglements (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL UNIQUE,
                        channel_id TEXT NOT NULL,
                        message_id TEXT,
                        rules TEXT NOT NULL,
                        created_at INTEGER DEFAULT (strftime('%s', 'now'))
                    )`);
                });
            }
        });

        // Base de données des rôles temporairement supprimés
        this.databases.tempRemovedRoles = new sqlite3.Database(this.getDbPath('temp_removed_roles.db'), sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Erreur lors de la connexion à la base de données des rôles temporairement supprimés :', err);
            } else {
                dbConnectLog('✓ Connecté à la base de données des rôles temporairement supprimés.');
                this.databases.tempRemovedRoles.serialize(() => {
                    this.databases.tempRemovedRoles.run(`CREATE TABLE IF NOT EXISTS temp_removed_roles (
                        userId TEXT NOT NULL,
                        roleId TEXT NOT NULL,
                        expires_at INTEGER NOT NULL,
                        PRIMARY KEY (userId, roleId)
                    )`);
                    this.databases.tempRemovedRoles.run(`ALTER TABLE temp_removed_roles ADD COLUMN expires_at INTEGER`, (err) => {
                        if (err && !err.message.includes('duplicate column')) console.error('Erreur ajout colonne expires_at:', err);
                    });
                });
            }
        });

        // Base de données des avertissements du staff
        this.databases.staffWarns = new sqlite3.Database(this.getDbPath('staff_warns.db'), sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Erreur lors de la connexion à la base de données des avertissements du staff :', err);
            } else {
                dbConnectLog('✓ Connecté à la base de données des avertissements du staff.');
                this.databases.staffWarns.serialize(() => {
                    this.databases.staffWarns.run(`CREATE TABLE IF NOT EXISTS staff_warns (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT NOT NULL,
                        moderatorId TEXT NOT NULL,
                        reason TEXT NOT NULL,
                        date INTEGER NOT NULL
                    )`);
                });
            }
        });

        // Base de données du profil staff
        this.databases.staffProfile = new sqlite3.Database(this.getDbPath('staff_profile.db'), sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Erreur lors de la connexion à la base de données du profil staff :', err);
            } else {
                dbConnectLog('✓ Connecté à la base de données du profil staff.');
                this.databases.staffProfile.serialize(() => {
                    // Table des périodes de modo test
                    this.databases.staffProfile.run(`CREATE TABLE IF NOT EXISTS modo_test_periods (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT NOT NULL,
                        start_date INTEGER NOT NULL,
                        end_date INTEGER NOT NULL,
                        status TEXT DEFAULT 'en_cours',
                        result TEXT,
                        reviewer_id TEXT,
                        created_at INTEGER DEFAULT (strftime('%s', 'now'))
                    )`);

                    // Table des candidatures
                    this.databases.staffProfile.run(`CREATE TABLE IF NOT EXISTS candidatures (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT NOT NULL,
                        type TEXT NOT NULL,
                        status TEXT DEFAULT 'en_attente',
                        date INTEGER NOT NULL,
                        reviewer_id TEXT,
                        review_date INTEGER
                    )`);
                    this.databases.staffProfile.run(`CREATE INDEX IF NOT EXISTS idx_candidatures_userId ON candidatures (userId)`);

                    // Migrations candidatures
                    const candidatureCols = [
                        { name: 'reviewer_id', type: 'TEXT' },
                        { name: 'review_date', type: 'INTEGER' }
                    ];
                    candidatureCols.forEach(col => {
                        this.databases.staffProfile.run(`ALTER TABLE candidatures ADD COLUMN ${col.name} ${col.type}`, (err) => {
                            if (err && !err.message.includes('duplicate column')) {
                                console.error(`Erreur ajout colonne ${col.name} à candidatures:`, err);
                            }
                        });
                    });

                    // Table des appréciations pour modo test
                    this.databases.staffProfile.run(`CREATE TABLE IF NOT EXISTS modo_test_appreciations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT NOT NULL,
                        periodo_test_id INTEGER,
                        reviewer_id TEXT NOT NULL,
                        appreciation TEXT NOT NULL,
                        date INTEGER NOT NULL,
                        FOREIGN KEY(periodo_test_id) REFERENCES modo_test_periods(id)
                    )`);

                    // Table des dates d'arrivée aux différents postes
                    this.databases.staffProfile.run(`CREATE TABLE IF NOT EXISTS staff_promotions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT NOT NULL,
                        role_id TEXT NOT NULL,
                        role_name TEXT NOT NULL,
                        date INTEGER NOT NULL,
                        promoted_by TEXT
                    )`);
                    this.databases.staffProfile.run(`CREATE INDEX IF NOT EXISTS idx_staff_promotions_userId ON staff_promotions (userId)`);

                    // Table de sensibilité (période après warn staff)
                    this.databases.staffProfile.run(`CREATE TABLE IF NOT EXISTS staff_sensitivity (
                        userId TEXT PRIMARY KEY,
                        start_date INTEGER NOT NULL,
                        end_date INTEGER NOT NULL,
                        active INTEGER DEFAULT 1
                    )`);

                    // Table des chances de candidatures/modo tests
                    this.databases.staffProfile.run(`CREATE TABLE IF NOT EXISTS staff_chances (
                        userId TEXT PRIMARY KEY,
                        candidature_chances INTEGER DEFAULT 2,
                        modo_test_chances INTEGER DEFAULT 1,
                        last_candidature_refresh INTEGER,
                        last_modo_test_refresh INTEGER
                    )`);
                });
            }
        });

        // Base de données des incidents de raid
        this.databases.raidIncidents = new sqlite3.Database(this.getDbPath('raid_incidents.db'), sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Erreur lors de la connexion à la base de données des incidents de raid :', err);
            } else {
                dbConnectLog('✓ Connecté à la base de données des incidents de raid.');
                this.databases.raidIncidents.serialize(() => {
                    // Table des incidents de raid
                    this.databases.raidIncidents.run(`CREATE TABLE IF NOT EXISTS raid_incidents (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guildId TEXT NOT NULL,
                        detected_at INTEGER NOT NULL,
                        peak_score INTEGER NOT NULL,
                        raider_count INTEGER DEFAULT 0,
                        criteria_triggered TEXT,
                        action_taken TEXT,
                        lockdown_activated INTEGER DEFAULT 0,
                        resolved_at INTEGER,
                        resolved_by TEXT,
                        notes TEXT
                    )`);
                    this.databases.raidIncidents.run(`CREATE INDEX IF NOT EXISTS idx_raid_incidents_guildId ON raid_incidents (guildId)`);
                    this.databases.raidIncidents.run(`CREATE INDEX IF NOT EXISTS idx_raid_incidents_detected_at ON raid_incidents (detected_at)`);

                    // Table des raiders détectés
                    this.databases.raidIncidents.run(`CREATE TABLE IF NOT EXISTS detected_raiders (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        incident_id INTEGER NOT NULL,
                        userId TEXT NOT NULL,
                        username TEXT,
                        account_age_days INTEGER,
                        join_timestamp INTEGER NOT NULL,
                        score_contribution INTEGER,
                        action_applied TEXT,
                        FOREIGN KEY(incident_id) REFERENCES raid_incidents(id)
                    )`);
                    this.databases.raidIncidents.run(`CREATE INDEX IF NOT EXISTS idx_detected_raiders_incident ON detected_raiders (incident_id)`);
                    this.databases.raidIncidents.run(`CREATE INDEX IF NOT EXISTS idx_detected_raiders_userId ON detected_raiders (userId)`);

                    // Migrations raid_incidents
                    const raidCols = [
                        { name: 'lockdown_activated', type: 'INTEGER DEFAULT 0' },
                        { name: 'notes', type: 'TEXT' }
                    ];
                    raidCols.forEach(col => {
                        this.databases.raidIncidents.run(`ALTER TABLE raid_incidents ADD COLUMN ${col.name} ${col.type}`, (err) => {
                            if (err && !err.message.includes('duplicate column')) {
                                console.error(`Erreur ajout colonne ${col.name} à raid_incidents:`, err);
                            }
                        });
                    });

                    // Migrations detected_raiders
                    const raiderCols = [
                        { name: 'username', type: 'TEXT' },
                        { name: 'account_age_days', type: 'INTEGER' },
                        { name: 'action_applied', type: 'TEXT' }
                    ];
                    raiderCols.forEach(col => {
                        this.databases.raidIncidents.run(`ALTER TABLE detected_raiders ADD COLUMN ${col.name} ${col.type}`, (err) => {
                            if (err && !err.message.includes('duplicate column')) {
                                console.error(`Erreur ajout colonne ${col.name} à detected_raiders:`, err);
                            }
                        });
                    });
                });
            }
        });

        // Base de données des absences staff
        this.databases.staffAbsences = new sqlite3.Database(this.getDbPath('staff_absences.db'), sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Erreur lors de la connexion à la base de données des absences staff :', err);
            } else {
                dbConnectLog('✓ Connecté à la base de données des absences staff.');
                this.databases.staffAbsences.serialize(() => {
                    this.databases.staffAbsences.run(`CREATE TABLE IF NOT EXISTS staff_absences (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        userId TEXT NOT NULL,
                        reason TEXT NOT NULL,
                        start_date INTEGER NOT NULL,
                        end_date INTEGER NOT NULL,
                        active INTEGER DEFAULT 1,
                        notified INTEGER DEFAULT 0,
                        created_at INTEGER DEFAULT (strftime('%s', 'now'))
                    )`);
                    this.databases.staffAbsences.run(`CREATE INDEX IF NOT EXISTS idx_staff_absences_userId ON staff_absences (userId)`);
                    this.databases.staffAbsences.run(`CREATE INDEX IF NOT EXISTS idx_staff_absences_active ON staff_absences (active)`);

                    // Migrations staff_absences
                    this.databases.staffAbsences.run(`ALTER TABLE staff_absences ADD COLUMN notified INTEGER DEFAULT 0`, (err) => {
                        if (err && !err.message.includes('duplicate column')) console.error('Erreur ajout colonne notified à staff_absences:', err);
                    });
                });
            }
        });
    }

    /**
     * Récupère une base de données par son nom
     */
    getDatabase(name) {
        return this.databases[name];
    }

    /**
     * Récupère la base de données des sanctions
     */
    getSanctionsDb() {
        return this.databases.sanctions;
    }

    /**
     * Récupère la base de données des notes
     */
    getNotesDb() {
        return this.databases.notes;
    }

    /**
     * Récupère la base de données des règles
     */
    getRulesDb() {
        return this.databases.rules;
    }

    /**
     * Récupère la base de données des rôles temporairement supprimés
     */
    getTempRemovedRolesDb() {
        return this.databases.tempRemovedRoles;
    }

    /**
     * Récupère la base de données des avertissements du staff
     */
    getStaffWarnsDb() {
        return this.databases.staffWarns;
    }

    /**
     * Récupère la base de données du profil staff
     */
    getStaffProfileDb() {
        return this.databases.staffProfile;
    }

    /**
     * Récupère la base de données des incidents de raid
     */
    getRaidIncidentsDb() {
        return this.databases.raidIncidents;
    }

    /**
     * Récupère la base de données des absences staff
     */
    getStaffAbsencesDb() {
        return this.databases.staffAbsences;
    }

    /**
     * Ferme toutes les connexions aux bases de données
     */
    closeAll() {
        Object.values(this.databases).forEach(db => {
            if (db) {
                db.close((err) => {
                    if (err) console.error('Erreur lors de la fermeture d\'une base de données :', err);
                });
            }
        });
    }
}

// Créer et exporter une instance unique (singleton)
const dbManagerInstance = new DatabaseManager();
module.exports = dbManagerInstance;