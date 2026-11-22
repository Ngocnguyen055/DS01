import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeRoot, prepareRuntime } from './runtime-paths.mjs';

await prepareRuntime();
const root = fileURLToPath(new URL('..', import.meta.url)), directory = await mkdtemp(join(runtimeRoot, 'evaluation-'));
const results = join(directory, 'tests.json');
console.log(`Evaluation evidence: ${directory}`);
const child = spawn(process.execPath, [join(root, 'scripts/run-tests.mjs'), '--reporter=default', '--reporter=json', `--outputFile=${results}`], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
const runner = await new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', error => resolve({ code: null, error: error.message }));
});
let report, reportError;
try {
    report = JSON.parse(await readFile(results, 'utf8'));
    if (!Array.isArray(report.testResults) || report.testResults.some(file => !Array.isArray(file.assertionResults))) throw Error('Invalid Vitest report format');
} catch (error) {
    report = undefined;
    reportError = `Cannot read test report ${results}: ${error.message}`;
}
const tests = report?.testResults.flatMap(file => file.assertionResults) || [];
const cases = {
    functional: ['returns complete public registration metadata', 'advertises complete metadata from PeerClient', 'sends and receives concurrently in both directions', 'deduplicates identical retries across DIRECT and RELAY', 'orders reordered and duplicate receives', 'refreshes membership before fan-out', 'exchanges simultaneous encrypted group messages and encrypted files', 'discovers and chats using a distributed hash ring'],
    concurrency: ['allows exactly one concurrent registration', 'converges concurrent queue writes and deletion', 'rejects simultaneous new events sharing one ID'],
    faultRecovery: ['replicates encrypted offline mail and ACKs', 'fails over when a connected relay accepts no RPCs', 'reconnects and restores committed groups'],
    security: ['encrypts text and authenticates metadata', 'requires cluster authentication and rejects replay', 'rejects unsigned, forged and expired'],
};
const matrix = Object.fromEntries(Object.entries(cases).map(([category, patterns]) => [category, patterns.map(pattern => {
    const test = tests.find(row => row.fullName.includes(pattern));
    return { scenario: pattern, passed: test?.status === 'passed', test: test?.fullName, durationMs: test?.duration };
})]));
const totals = Object.fromEntries(Object.entries(matrix).map(([category, cases]) => [category, cases.filter(row => row.passed).length]));
const failures = tests.filter(test => test.status === 'failed').map(test => ({ test: test.fullName, messages: test.failureMessages }));
const failedSuites = report?.testResults.filter(file => file.status === 'failed').map(file => ({ file: file.name, message: file.message })) || [];
const testsPassed = runner.code === 0 && report?.success === true && !failures.length && !failedSuites.length;
const passed = testsPassed && totals.functional >= 8 && totals.concurrency >= 2 && totals.faultRecovery >= 2 && totals.security >= 2;
await writeFile(join(directory, 'evaluation.json'), JSON.stringify({ requirement: 'DS01 section 9', passed, totals, matrix, totalTests: tests.length, runner, reportError, failures, failedSuites, performance: 'Run test:browser for latency/load matrix and test:browser:advanced for TURN/media/recovery metrics. These are separate experiments.', finishedAt: new Date().toISOString() }, null, 2));
console.log(JSON.stringify({ passed, totals, totalTests: tests.length, failedTests: failures.length }));
if (!passed) {
    if (reportError) console.error(reportError);
    if (!testsPassed) console.error(`Test runner failed (code=${runner.code}, signal=${runner.signal || 'none'}${runner.error ? `, error=${runner.error}` : ''}). Failed tests: ${failures.length}; failed suites: ${failedSuites.length}.`);
    for (const failure of failures) console.error(`FAIL ${failure.test}\n${(failure.messages || []).join('\n')}`);
    for (const [category, scenarios] of Object.entries(matrix)) for (const scenario of scenarios) if (!scenario.passed) console.error(`Missing or failed ${category} scenario: ${scenario.scenario}`);
    console.error(`Evaluation failed. Full report: ${results}`);
    process.exitCode = 1;
}
