/**
 * PebbleHost : aligne le disque sur GitHub (branch main).
 * Couper : BLZ_PEBBLE_GIT_RESET=0
 */
const { runPebbleGitSync } = require('./pebble-git-sync');

runPebbleGitSync({ exitOnFail: true, force: true });
