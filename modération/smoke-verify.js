/* Smoke test temporaire — supprimer après validation. */
const { installVerificationSystem } = require('./src/lib/verification');
const { signState } = require('./src/lib/verification/cryptoUtil');
const { EventEmitter } = require('events');

class FakeClient extends EventEmitter {
    constructor() {
        super();
        this.token = 'fake';
        this.users = { fetch: async () => null };
        this.channels = { fetch: async () => null };
    }
}
const client = new FakeClient();
const STATE_SECRET = 'a'.repeat(64);

const r = installVerificationSystem(client, {
    botToken: 'fakebot',
    publicBaseUrl: 'http://127.0.0.1:37822',
    stateSecret: STATE_SECRET,
    httpPort: 37822,
    ownerDmIds: [],
});

setTimeout(() => {
    const state = signState(
        { discordUserId: '123456789012345678', guildId: '987654321098765432' },
        STATE_SECRET,
    );
    const http = require('http');
    http.get('http://127.0.0.1:37822/verify/start?state=' + encodeURIComponent(state), (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
            const ok = res.statusCode === 200;
            const hasForm = body.includes('form method="POST"');
            const hasState = body.includes(state.slice(0, 30));
            console.log('GET /verify/start valid status =', res.statusCode);
            console.log('contains form     =', hasForm);
            console.log('contains state    =', hasState);
            console.log('result            =', ok && hasForm && hasState ? 'OK' : 'FAIL');
            r.server.close(() => process.exit(ok && hasForm && hasState ? 0 : 1));
        });
    });
}, 500);
