const fs = require('node:fs');
const { renderQuetesRebornPng } = require('./src/lib/canvasQuetesReborn');

(async () => {
  const buf = await renderQuetesRebornPng({
    displayName: 'Koyorin',
    avatarUrl: null,
    summary: {
      msgs_today: 9,
      daily_target: 15,
      daily_claimed: false,
      daily_reward: 25000n,
      week_points: 9,
      weekly_target: 50,
      weekly_claimed: false,
      weekly_reward: 150000n,
      selection_line: 'Aucune quête à choix sélectionnée — choisis-en une dans le menu ci-dessous.',
      selection_id: '',
      reward_mult: 1,
      skips_total: 0,
      skips_used: 0,
      skips_left: 0,
      selection_slots: 3,
    },
    spawner: { available: false, locked: true, msLeft: 0 },
  });
  fs.writeFileSync('test-quetes.png', buf);
  console.log('OK', buf.length, 'bytes →', 'test-quetes.png');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
