require('dotenv').config();
const { REST, Routes } = require('discord.js');

(async () => {
  const token = process.env.REBORN_TEST_BOT_TOKEN;
  if (!token) { console.error('no token'); process.exit(1); }
  const rest = new REST({ version: '10' }).setToken(token);
  const id = '1097110036192448656';

  console.log('--- guild preview ---');
  try {
    const p = await rest.get(Routes.guildPreview(id));
    console.log({ name: p.name, icon: p.icon, features: p.features });
    if (p.icon) {
      const ext = String(p.icon).startsWith('a_') ? 'gif' : 'png';
      console.log('iconURL:', `https://cdn.discordapp.com/icons/${id}/${p.icon}.${ext}?size=256`);
    }
  } catch (e) {
    console.warn('preview KO:', e?.message || e, e?.status);
  }

  console.log('--- guild get ---');
  try {
    const g = await rest.get(Routes.guild(id));
    console.log({ name: g.name, icon: g.icon });
  } catch (e) {
    console.warn('guild GET KO:', e?.message || e, e?.status);
  }
})();
