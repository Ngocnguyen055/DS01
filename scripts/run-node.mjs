import { build, context } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const [kind, ...flags] = process.argv.slice(2);
const entries = { signaling: 'src/signaling/index.ts', relay: 'src/relay/index.ts', benchmark: 'scripts/benchmark-relay.ts' };
if (!Object.hasOwn(entries, kind) || flags.some(flag => flag !== '--watch') || (kind === 'benchmark' && flags.length))
    throw Error('Usage: node scripts/run-node.mjs signaling|relay [--watch], or benchmark');
const watching = flags.includes('--watch');
const dataRoot = resolve(root, '.data');

const directory = join(dataRoot, `runtime-${kind}-${randomUUID()}`);
const outfile = join(directory, 'entry.mjs');
await mkdir(directory, { recursive: true });
let service, watcher, stopping = false, revision = 0;
async function start() {
    if (stopping) return;
    if (service) await service.close();
    service = undefined;
    const module = await import(`${pathToFileURL(outfile).href}?revision=${++revision}`);
    if (kind === 'benchmark') return;
    service = kind === 'signaling'
        ? module.createSignaling(undefined, undefined, undefined, { statePath: process.env.SIGNAL_STATE_PATH || join(dataRoot, 'signaling.json'), accountStatePath: process.env.ACCOUNT_STATE_PATH })
        : module.createRelay();
    const port = Number(kind === 'signaling' ? process.env.SIGNAL_PORT || 4001 : process.env.RELAY_PORT || 4002);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Service port must be 1..65535');
    await new Promise((resolve, reject) => {
        service.httpServer.once('error', reject);
        service.httpServer.listen(port, '0.0.0.0', resolve);
    });
    console.log(`${new Date().toISOString()} [${kind}] LISTENING ${port} node=${process.env.NODE_ID || `${kind}-${process.pid}`}`);
}
async function removeBundle() {
    const checked = resolve(directory);
    if (dirname(checked) !== dataRoot || !basename(checked).startsWith(`runtime-${kind}-`)) throw Error('Unexpected runtime cleanup path');
    await rm(checked, { recursive: true, force: true });
}
async function stop() {
    stopping = true;
    if (watcher) await watcher.dispose();
    if (service) await service.close();
    await removeBundle();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void stop().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
});
const options = {
    absWorkingDir: root, entryPoints: [entries[kind]], outfile, bundle: true,
    platform: 'node', format: 'esm', target: 'node20', sourcemap: 'inline',
    external: ['dotenv', 'express', 'jsonwebtoken', 'socket.io', 'socket.io-client', 'zod'],
};
try {
    if (watching) {
        watcher = await context({
            ...options, plugins: [{
                name: 'restart-service', setup(builder) {
                    builder.onEnd(async result => {
                        if (result.errors.length || stopping) return;
                        try { await start(); }
                        catch (error) { console.error(`Service restart failed: ${error.message}`); }
                    });
                }
            }]
        });
        await watcher.watch();
    }
    else {
        await build(options);
        await start();
        await removeBundle();
    }
}
catch (error) {
    console.error(`Cannot start ${kind}: ${error.message}`);
    process.exitCode = 1;
    await stop();
}
