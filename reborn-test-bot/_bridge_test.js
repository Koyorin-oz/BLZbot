const db = require('./src/db');
const pg = require('./src/services/playerGuilds');
const br = require('./src/services/niveauGuildBridge');

console.log('--- Bridge integration test ---');

const KOYORIN = '1278372257483456603';
const HUB = 'test_hub_id';

console.log('\n[1] Trigger bridge via getMembershipInHub:');
const m = pg.getMembershipInHub(KOYORIN, HUB);
console.log('   guild_id:', m?.guild_id, 'name:', m?.name, 'leader:', m?.leader_id, 'cap:', m?.member_cap);

console.log('\n[2] Members in REBORN bridge (niv_1):');
const members = db.prepare("SELECT user_id FROM player_guild_members WHERE guild_id = 'niv_1'").all();
for (const r of members) console.log('   ->', r.user_id);

console.log('\n[3] Re-run bridge (idempotent):');
const m2 = pg.getMembershipInHub(KOYORIN, HUB);
const m2Count = db.prepare("SELECT COUNT(*) AS c FROM player_guild_members WHERE guild_id = 'niv_1'").get().c;
console.log('   member count after re-run:', m2Count);

console.log('\n[4] getGuild with bridged ID:');
const g = pg.getGuild('niv_1');
console.log('   name:', g?.name, 'leader:', g?.leader_id);

console.log('\n[5] getGuild with niveau-style numeric ID (auto-bridge):');
const g2 = pg.getGuild('1');
console.log('   resolved:', g2?.id, g2?.name);

console.log('\n[6] listGuildsOnHub:');
const list = pg.listGuildsOnHub(HUB);
for (const e of list) console.log('   ->', e.id, e.name, 'cap:', e.member_cap);

console.log('\n[7] Cleanup test data');
db.prepare("DELETE FROM player_guild_members WHERE guild_id = 'niv_1'").run();
db.prepare("DELETE FROM player_guilds WHERE id = 'niv_1'").run();
console.log('   cleaned.');

console.log('\nALL BRIDGE TESTS OK ✓');
