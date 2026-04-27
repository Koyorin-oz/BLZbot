const cfg = require('./config');
const { deploySlashCommands } = require('./slashDeploy');

cfg.assertToken();
cfg.assertClientIdForDeploy();

(async () => {
  try {
    const g = cfg.guildId;
    console.log(
      '[deploy] Cible API — CLIENT_ID=',
      cfg.clientId,
      g ? `GUILD_ID=${g} (slash visibles sur CE serveur uniquement)` : 'GUILD_ID vide = déploiement global (délai jusqu’à 1h)',
    );
    const r = await deploySlashCommands();
    if (!r.ok) {
      console.error('[deploy]', r.reason);
      process.exit(1);
    }
    if (r.scope === 'guild') {
      console.log(`[deploy] ${r.count} commande(s) guild → ${r.guildId}`);
    } else {
      console.log(`[deploy] ${r.count} commande(s) globales`);
    }
  } catch (e) {
    console.error('[deploy]', e);
    process.exit(1);
  }
})();
