import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile), directories = [];
const scenarios = [
    'returns complete public registration metadata',
    'advertises complete metadata from PeerClient',
    'sends and receives concurrently in both directions',
    'deduplicates identical retries across DIRECT and RELAY',
    'orders reordered and duplicate receives',
    'refreshes membership before fan-out',
    'exchanges simultaneous encrypted group messages and encrypted files',
    'discovers and chats using a distributed hash ring',
    'allows exactly one concurrent registration',
    'converges concurrent queue writes and deletion',
    'replicates encrypted offline mail and ACKs',
    'fails over when a connected relay accepts no RPCs',
    'encrypts text and authenticates metadata',
    'requires cluster authentication and rejects replay',
];
function testReport(extra = [], required = scenarios) {
    const assertions = required.map(fullName => ({ fullName, status: 'passed', failureMessages: [], duration: 1 })).concat(extra);
    const failed = assertions.some(test => test.status === 'failed');
    return { success: !failed, testResults: [{ name: 'fixture.test.ts', status: failed ? 'failed' : 'passed', message: '', assertionResults: assertions }] };
}
async function evaluate(report, code) {
    const directory = await mkdtemp(join(tmpdir(), 'ds01-evaluation-test-'));
    directories.push(directory);
    const scripts = join(directory, 'scripts'), evidence = join(directory, 'evidence');
    await mkdir(scripts);
    await mkdir(evidence);
    await copyFile(new URL('../scripts/evaluate.mjs', import.meta.url), join(scripts, 'evaluate.mjs'));
    await writeFile(join(scripts, 'runtime-paths.mjs'), 'export const runtimeRoot = process.env.DS01_EVALUATION_FIXTURE; export async function prepareRuntime() {}');
    await writeFile(join(scripts, 'run-tests.mjs'), `
        import { writeFile } from 'node:fs/promises';
        const args = process.argv.slice(2);
        if (!args.includes('--reporter=default') || !args.includes('--reporter=json')) throw Error('Both console and JSON reporters are required');
        const report = ${JSON.stringify(report ?? null)};
        if (report) await writeFile(args.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length), JSON.stringify(report));
        process.exitCode = ${code};
    `);
    const result = await execute(process.execPath, [join(scripts, 'evaluate.mjs')], {
        cwd: directory, windowsHide: true, timeout: 10000,
        env: { ...process.env, DS01_EVALUATION_FIXTURE: evidence },
    }).then(result => ({ ...result, code: 0 }), error => error);
    const [run] = await readdir(evidence);
    return { ...result, evaluation: JSON.parse(await readFile(join(evidence, run, 'evaluation.json'), 'utf8')) };
}
afterEach(async () => {
    for (const directory of directories.splice(0)) {
        const checked = resolve(directory);
        if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('ds01-evaluation-test-')) throw Error('Unexpected evaluation cleanup path');
        await rm(checked, { recursive: true, force: true });
    }
});

describe('evaluation runner diagnostics and exit status', () => {
    it('succeeds only when the test run and required scenario counts both pass', async () => {
        const result = await evaluate(testReport(), 0);
        expect(result.code).toBe(0);
        expect(result.evaluation).toMatchObject({ passed: true, totalTests: 14, totals: { functional: 8, concurrency: 2, faultRecovery: 2, security: 2 } });
    });
    it('reports a failed test outside the requirement matrix and preserves the failed exit status', async () => {
        const failure = { fullName: 'dashboard detects a crashed relay', status: 'failed', failureMessages: ['Timeout relay crash'], duration: 5000 };
        const result = await evaluate(testReport([failure]), 1);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('FAIL dashboard detects a crashed relay');
        expect(result.stderr).toContain('Timeout relay crash');
        expect(result.evaluation).toMatchObject({ passed: false, totals: { functional: 8 }, failures: [{ test: failure.fullName, messages: failure.failureMessages }] });
    });
    it('writes a failed evaluation with an explicit diagnostic when the runner produces no JSON report', async () => {
        const result = await evaluate(undefined, 1);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('Cannot read test report');
        expect(result.evaluation).toMatchObject({ passed: false, totalTests: 0, runner: { code: 1 } });
        expect(result.evaluation.reportError).toContain('tests.json');
    });
    it('fails when a required functional scenario is absent even if the test runner succeeds', async () => {
        const result = await evaluate(testReport([], scenarios.slice(1)), 0);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(`Missing or failed functional scenario: ${scenarios[0]}`);
        expect(result.evaluation).toMatchObject({ passed: false, totals: { functional: 7 }, runner: { code: 0 } });
    });
});
