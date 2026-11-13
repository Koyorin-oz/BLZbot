const fs = require('node:fs');
const dotenv = require('dotenv');

function loadInsiderEnvironment(envPath, productionEnvPath) {
    const parsed = dotenv.parse(fs.readFileSync(envPath));

    if (fs.existsSync(productionEnvPath)) {
        const productionKeys = Object.keys(
            dotenv.parse(fs.readFileSync(productionEnvPath))
        );
        for (const key of productionKeys) {
            delete process.env[key];
        }
    }

    const { error } = dotenv.config({ path: envPath, override: true, quiet: true });
    if (error) throw error;

    process.env.BLZ_INSIDER_MODE = '1';
    process.env.DOTENV_CONFIG_PATH = envPath;

    const originalConfig = dotenv.config.bind(dotenv);
    dotenv.config = (options = {}) =>
        originalConfig({
            ...options,
            path: envPath,
            override: true,
            quiet: options.quiet === undefined ? true : options.quiet,
        });

    return parsed;
}

module.exports = { loadInsiderEnvironment };
