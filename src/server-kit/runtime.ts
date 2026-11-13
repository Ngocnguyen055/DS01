import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Socket } from 'socket.io';
export function serviceLog(service: string, event: string, detail = '') {
    console.log(`${new Date().toISOString()} [${service}] ${event}${detail ? ` ${detail}` : ''} node=${process.env.NODE_ID || `${service}-${process.pid}`}`);
}
/** One writer per state file. Never silently reset a damaged identity registry. */
export class AtomicState<T> {
    constructor(private path?: string) { }
    read(validate: (input: unknown) => T): T | undefined {
        if (!this.path || !existsSync(this.path))
            return;
        return validate(JSON.parse(readFileSync(this.path, 'utf8')));
    }
    write(value: T) {
        if (!this.path)
            return;
        mkdirSync(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.tmp`;
        writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
        renameSync(temporary, this.path);
    }
}
export function guardSocket(socket: Socket, service: string, rpcEvents: string[]) {
    let since = Date.now(), count = 0;
    socket.use((packet, next) => {
        const [event, ...args] = packet;
        const reply = args.at(-1);
        if (rpcEvents.includes(event) && typeof reply !== 'function') {
            serviceLog(service, 'REJECT', `${event}: callback required`);
            return;
        }
        if (Date.now() - since > 10000) {
            since = Date.now();
            count = 0;
        }
        if (++count > 1000) {
            if (typeof reply === 'function')
                reply({ ok: false, error: 'rate limit exceeded' });
            serviceLog(service, 'REJECT', `${event}: rate limit`);
            return;
        }
        if (typeof reply === 'function')
            packet[packet.length - 1] = (response: unknown, ...rest: unknown[]) => {
                if (response && typeof response === 'object' && 'ok' in response && response.ok === false)
                    serviceLog(service, 'REJECT', `${event}: ${'error' in response ? String(response.error) : 'request denied'}`);
                reply(response, ...rest);
            };
        next();
    });
    socket.on('error', error => serviceLog(service, 'ERROR', String(error.message)));
}
