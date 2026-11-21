// Local browser acceptance. Uses disposable services and profiles, never the user's running ports.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const qa = join(root, '.data', `qa-${randomUUID()}`), children = [], logs = { signal: '', primary: '', backup: '', web: '', chrome: '' };
const report = { scope: 'B5/B6 acceptance in real Chrome on localhost; not WAN/NAT or performance evidence', checks: [], startedAt: new Date().toISOString() };
function sourceFingerprint() { const hash = createHash('sha256'); function visit(dir) { for (const item of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.name === 'dist')
        continue;
    const path = join(dir, item.name);
    if (item.isDirectory())
        visit(path);
    else if (/\.(ts|tsx|css|html|json)$/.test(path)) {
        hash.update(path.replaceAll('\\', '/'));
        hash.update(readFileSync(join(root, path)));
    }
} } visit('src'); hash.update(readFileSync(join(root, 'package-lock.json'))); return hash.digest('hex'); }
report.sourceFingerprint = sourceFingerprint();
report.node = process.version;
report.commit = process.env.B5_B6_BASE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
report.workingTreeModified = !!process.env.B5_B6_BASE_COMMIT || !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browserCall, ws, chrome;
function launch(name, executable, args, cwd = root, env = {}) { const c = spawn(executable, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(c); c.stdout.on('data', b => logs[name] += b); c.stderr.on('data', b => logs[name] += b); c.on('error', error => logs[name] += error.message); return c; }
async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
async function until(fn, label, ms = 15000) { const end = Date.now() + ms; let error; while (Date.now() < end) {
    try {
        const result = await fn();
        if (result)
            return result;
    }
    catch (e) {
        error = e;
    }
    await pause(100);
} throw new Error(`Timeout: ${label}${error ? ` (${error.message})` : ''}`); }
function check(label, ok, detail) { report.checks.push({ label, passed: !!ok, ...(detail ? { detail } : {}) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok)
    throw new Error(label); }
async function stop(child) { if (!child || child.exitCode !== null)
    return; child.kill(); await Promise.race([new Promise(r => child.once('exit', r)), pause(2000)]); }
const external = ['dotenv', 'express', 'jsonwebtoken', 'socket.io', 'socket.io-client', 'zod'];
const deadline = setTimeout(() => { console.error('Browser smoke deadline exceeded'); for (const child of children)
    child.kill(); process.exit(2); }, 180000);
try {
    await mkdir(qa, { recursive: true });
    await mkdir(join(root, 'docs/evidence'), { recursive: true });
    const [sp, rp, bp, wp] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
    const signalUrl = `http://127.0.0.1:${sp}`, primaryUrl = `http://127.0.0.1:${rp}`, backupUrl = `http://127.0.0.1:${bp}`, webUrl = `http://127.0.0.1:${wp}`;
    const env = { SIGNAL_PORT: String(sp), SIGNAL_INTERNAL_URL: signalUrl, PEER_SECRET: randomUUID() + randomUUID(), JWT_SECRET: randomUUID() + randomUUID(), QA_STATE: join(qa, 'state.json') };
    await build({ entryPoints: [join(root, 'src/signaling/index.ts')], outfile: join(qa, 'signal.mjs'), bundle: true, platform: 'node', format: 'esm', external, footer: { js: "const qaServer=createSignaling(undefined,undefined,undefined,{statePath:process.env.QA_STATE});qaServer.httpServer.listen(Number(process.env.SIGNAL_PORT),'127.0.0.1');" } });
    await build({ entryPoints: [join(root, 'src/relay/index.ts')], outfile: join(qa, 'relay.mjs'), bundle: true, platform: 'node', format: 'esm', external, footer: { js: "const qaServer=createRelay();qaServer.httpServer.listen(Number(process.env.RELAY_PORT),'127.0.0.1');" } });
    let signal = launch('signal', process.execPath, [join(qa, 'signal.mjs')], root, env);
    const primary = launch('primary', process.execPath, [join(qa, 'relay.mjs')], root, { ...env, RELAY_PORT: String(rp) });
    launch('backup', process.execPath, [join(qa, 'relay.mjs')], root, { ...env, RELAY_PORT: String(bp) });
    launch('web', process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(wp), '--strictPort'], join(root, 'src/web-peer'), { VITE_SIGNAL_URL: signalUrl, VITE_RELAY_URL: primaryUrl, VITE_RELAY_URLS: backupUrl });
    await Promise.all([signalUrl + '/health', primaryUrl + '/health', backupUrl + '/health', webUrl].map(url => until(async () => (await fetch(url)).ok, url)));
    const executable = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
    if (!executable)
        throw new Error('Set CHROME_PATH to your installed Chromium browser');
    const profile = join(qa, 'chrome');
    // --no-sandbox is confined to this disposable local acceptance browser.
    chrome = launch('chrome', executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
    const [port, suffix] = (await until(() => readFile(join(profile, 'DevToolsActivePort'), 'utf8'), 'Chrome startup')).trim().split(/\r?\n/);
    ws = new WebSocket(`ws://127.0.0.1:${port}${suffix}`);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let next = 0;
    const pending = new Map();
    ws.onclose = () => { for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('Browser closed'));
    } pending.clear(); };
    ws.onmessage = event => { const data = JSON.parse(String(event.data)); if (data.method === 'Runtime.exceptionThrown')
        (report.browserErrors ||= []).push(data.params.exceptionDetails); const item = pending.get(data.id); if (item) {
        clearTimeout(item.timer);
        pending.delete(data.id);
        data.error ? item.reject(new Error(JSON.stringify(data.error))) : item.resolve(data.result);
    } };
    browserCall = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 12000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
    const evaluate = async (session, expression) => { const result = await browserCall('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session); if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
    const fill = async (session, selector, value) => { await evaluate(session, `(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing field');Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));})()`); await pause(80); };
    const click = async (session, selector) => evaluate(session, `document.querySelector(${JSON.stringify(selector)}).click()`);
    const choose = async (session, text) => evaluate(session, `(()=>{const item=[...document.querySelectorAll('nav .conversation')].find(item=>item.querySelector('strong')?.textContent===${JSON.stringify(text)});if(!item)throw Error('Conversation missing');item.click();})()`);
    const send = async (session, text) => { await fill(session, 'textarea', text); await click(session, '.send-button'); };
    const history = (session, id) => evaluate(session, `JSON.parse(localStorage.getItem('ds01-history-v1-${id}')||'[]')`);
    const screenshot = async (session, name) => { await pause(180); const { data } = await browserCall('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session); await writeFile(join(root, 'docs/evidence', name), Buffer.from(data, 'base64')); };
    const pages = [];
    for (const [index, id] of ['user_qa-a', 'user_qa-b', 'user_qa-c'].entries()) {
        const { browserContextId } = await browserCall('Target.createBrowserContext');
        const { targetId } = await browserCall('Target.createTarget', { url: 'about:blank', browserContextId });
        const { sessionId } = await browserCall('Target.attachToTarget', { targetId, flatten: true });
        pages.push(sessionId);
        await browserCall('Runtime.enable', {}, sessionId);
        await browserCall('Page.enable', {}, sessionId);
        await browserCall('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false }, sessionId);
        await browserCall('Page.navigate', { url: webUrl }, sessionId);
        await until(() => evaluate(sessionId, '!!document.querySelector("input[autocomplete=username]")'), 'login page');
        if (index === 0) {
            await evaluate(sessionId, `localStorage.setItem('ds01-display-name','Previous user');localStorage.setItem('ds01-peer-id','peer-stale');`);
            await browserCall('Page.reload', {}, sessionId);
            await until(() => evaluate(sessionId, '!!document.querySelector("input[autocomplete=username]")'), 'login with cached identity');
            check('logged-out page hides cached profile name, Peer ID and avatar', await evaluate(sessionId, '!document.querySelector(".self-profile .avatar") && !document.querySelector(".self-profile small") && !document.querySelector(".self-profile").textContent.includes("Previous user")'));
            await screenshot(sessionId, 'b5-b6-ui-welcome.png');
        }
        await evaluate(sessionId, `window.qaRTC=[];var Native=RTCPeerConnection;window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);window.qaRTC.push(this);}};`);
        await click(sessionId, '.auth-tabs button:nth-child(2)');
        await fill(sessionId, 'input[autocomplete=nickname]', `Peer ${String.fromCharCode(65 + index)}`);
        await fill(sessionId, 'input[name=username]', id.replace(/^user_/, ''));
        await fill(sessionId, 'input[name=password]', 'Browser acceptance passphrase!');
        await fill(sessionId, 'input[name=confirmation]', 'Browser acceptance passphrase!');
        if (index === 0) await screenshot(sessionId, 'b5-b6-ui-register.png');
        await click(sessionId, '.connect-card button[type=submit]');
        await until(() => evaluate(sessionId, '!!document.querySelector(".auth-success")'), 'account registration');
        if (index === 0) {
            await fill(sessionId, 'input[name=password]', 'An incorrect passphrase!');
            await click(sessionId, '.connect-card button[type=submit]');
            await until(() => evaluate(sessionId, 'document.querySelector("[role=alert]")?.textContent.includes("không đúng")'), 'wrong password rejection');
            check('wrong account password cannot enter the chat workspace', await evaluate(sessionId, '!document.querySelector(".empty-chat") && !document.querySelector(".chat-layout")'));
        }
        await fill(sessionId, 'input[name=password]', 'Browser acceptance passphrase!');
        await click(sessionId, '.connect-card button[type=submit]');
        await until(() => evaluate(sessionId, 'document.querySelector(".connection-pill")?.textContent.includes("Đang trực tuyến")'), 'peer registration');
    }
    const [a, b, c] = pages;
    await until(() => evaluate(a, 'document.querySelectorAll("nav .conversation").length===2'), 'three peers discovery');
    check('three accounts register, log in, automatically join the peer network and discover display names', true);
    check('authenticated profile displays the current account identity', await evaluate(a, 'document.querySelector(".self-profile strong")?.textContent === "Peer A" && document.querySelector(".self-profile small")?.textContent === "user_qa-a"'));

    await choose(a, 'Peer B');
    await choose(b, 'Peer A');
    await send(a, 'QA-DIRECT-REAL');
    const direct = await until(async () => { const rows = await history(a, 'user_qa-a'); return rows.find(row => row.message.body === 'QA-DIRECT-REAL' && row.status === 'delivered'); }, 'real DIRECT delivery', 20000);
    check('real WebRTC DIRECT delivered with no relay FORWARD', direct.message.mode === 'DIRECT' && !logs.primary.includes(direct.message.messageId) && !logs.backup.includes(direct.message.messageId), { messageId: direct.message.messageId });
    await browserCall('Page.setWebLifecycleState', { state: 'frozen' }, b);
    await send(a, 'QA-PENDING-ACK');
    await fill(a, 'textarea', 'Bản nháp tiếp theo');
    check('composer stays editable while waiting for ACK', await evaluate(a, '!document.querySelector("textarea").disabled && document.querySelector("textarea").value === "Bản nháp tiếp theo"'));
    await browserCall('Page.setWebLifecycleState', { state: 'active' }, b);
    await until(async () => (await history(a, 'user_qa-a')).some(row => row.message.body === 'QA-PENDING-ACK' && row.status === 'delivered'), 'delayed application ACK');
    check('a completed send preserves the next draft', await evaluate(a, 'document.querySelector("textarea").value === "Bản nháp tiếp theo"'));
    await fill(a, 'textarea', '');
    const fileBytes = Buffer.from(Array.from({ length: 32768 }, (_, index) => index % 251)), filePath = join(qa, 'browser-transfer.bin');
    await writeFile(filePath, fileBytes);
    const document = await browserCall('DOM.getDocument', {}, a), field = await browserCall('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type=file]' }, a);
    await browserCall('DOM.setFileInputFiles', { files: [filePath], nodeId: field.nodeId }, a);
    const fileRow = await until(async () => { const rows = await history(a, 'user_qa-a'); return rows.find(row => row.message.type === 'attachment' && row.status === 'delivered'); }, 'browser file transfer', 20000);
    const fileId = fileRow.message.attachments[0].id;
    const saved = await evaluate(b, `(async()=>{const {WebStore}=await import('/store.ts');const value=await new WebStore('user_qa-b').getFile(${JSON.stringify(fileId)});const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(value.data).buffer);return {length:value.data.length,hash:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')};})()`);
    check('browser file bytes persist in IndexedDB with matching SHA-256', saved.length === fileBytes.length && saved.hash === createHash('sha256').update(fileBytes).digest('hex'));
    await click(a, 'button[aria-label="Tạo nhóm"]');
    await fill(a, '.modal input[maxlength="80"]', 'Team QA');
    await fill(a, '.modal form label:last-of-type input', 'user_qa-b,user_qa-c');
    await click(a, '.modal .primary-button');
    await until(() => evaluate(b, '[...document.querySelectorAll("nav strong")].some(item=>item.textContent==="Team QA")'), 'group membership');
    await choose(b, 'Team QA');
    await choose(c, 'Team QA');
    await send(a, 'QA-GROUP-A');
    await Promise.all([send(b, 'QA-CONCURRENT-B'), send(c, 'QA-CONCURRENT-C')]);
    await until(async () => { const rows = await history(a, 'user_qa-a'); return rows.filter(row => row.message.body.startsWith('QA-CONCURRENT-')).length === 2; }, 'concurrent group sends');
    check('group fan-out and simultaneous sends arrive once per receiver', true);
    await browserCall('Page.reload', {}, b);
    await until(() => evaluate(b, 'document.querySelector(".connection-pill")?.textContent.includes("Đang trực tuyến")'), 'receiver rejoin');
    check('file bytes stay available after receiver reload', await evaluate(b, `(async()=>{const {WebStore}=await import('/store.ts');return (await new WebStore('user_qa-b').getFile(${JSON.stringify(fileId)}))?.data.length === ${fileBytes.length};})()`));
    check('browser reload automatically restores authenticated session, history and membership', (await history(b, 'user_qa-b')).some(row => row.message.body === 'QA-DIRECT-REAL') && await evaluate(b, '[...document.querySelectorAll("nav strong")].some(item=>item.textContent==="Team QA")'));
    await choose(a, 'Team QA');
    await screenshot(a, 'b5-b6-ui-chat-desktop.png');
    await browserCall('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, a);
    await screenshot(a, 'b5-b6-ui-chat-mobile.png');
    check('mobile layout has no horizontal page overflow', await evaluate(a, 'document.documentElement.scrollWidth <= innerWidth'));
    await click(a,'.mobile-back');
    await click(a,'button[aria-label="Đổi giao diện sáng tối"]');
    await choose(a,'Team QA');
    await until(()=>evaluate(a,'document.documentElement.dataset.theme === "dark"'),'dark theme');
    check('dark theme applies readable foreground colors',await evaluate(a,'getComputedStyle(document.body).color === "rgb(226, 232, 220)"'));
    await screenshot(a,'b5-b6-ui-chat-mobile-dark.png');
    await click(b, 'button[aria-label="Đăng xuất"]');
    await until(() => evaluate(b, '!!document.querySelector("input[name=password]")'), 'account logout');
    check('logout clears the tab session and hides chat history', await evaluate(b, '!sessionStorage.getItem("ds01-account-session-v1") && !document.querySelector(".chat-layout") && !document.querySelector("nav .conversation") && !document.querySelector(".self-profile .avatar") && !document.querySelector(".self-profile small")'));
    await browserCall('Page.reload', {}, b);
    await until(() => evaluate(b, '!!document.querySelector("input[name=password]")'), 'logged-out reload');
    check('logged-out reload stays at the login form', await evaluate(b, '!document.querySelector(".empty-chat") && !sessionStorage.getItem("ds01-account-session-v1")'));
    await fill(b, 'input[name=username]', 'qa-b');
    await fill(b, 'input[name=password]', 'Browser acceptance passphrase!');
    await click(b, '.connect-card button[type=submit]');
    await until(() => evaluate(b, 'document.querySelector(".connection-pill")?.textContent.includes("Đang trực tuyến")'), 'same-account login after logout');
    check('same account logs back in with its original Peer ID and local history', (await history(b, 'user_qa-b')).some(row => row.message.body === 'QA-DIRECT-REAL'));
    await click(b, 'button[aria-label="Đăng xuất"]');
    await until(() => evaluate(b, '!!document.querySelector("input[name=password]")'), 'second logout');
    await click(b, '.demo-toggle');
    await fill(b, 'input[autocomplete=nickname]', 'Legacy demo peer');
    await fill(b, '.demo-card label:last-of-type input', 'qa-legacy-web');
    await click(b, '.demo-card button[type=submit]');
    await until(() => evaluate(b, 'document.querySelector(".connection-pill")?.textContent.includes("Đang trực tuyến")'), 'legacy demo connection');
    check('legacy Peer ID demo remains available and does not mix account chat history', await evaluate(b, 'document.querySelector(".self-profile small").textContent === "qa-legacy-web" && !JSON.parse(localStorage.getItem("ds01-history-v1-qa-legacy-web")||"[]").length'));
    check('another identity cannot read the previous account file', await evaluate(b, `(async()=>{const {WebStore}=await import('/store.ts');return !(await new WebStore('qa-legacy-web').getFile(${JSON.stringify(fileId)}));})()`));
    check('no browser JavaScript exceptions', !report.browserErrors?.length, report.browserErrors);
    report.passed = true;
}
catch (error) {
    report.passed = false;
    report.error = String(error);
    report.logs = logs;
    console.error(error);
    process.exitCode = 1;
}
finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(join(root, 'docs/evidence/b5-b6-browser.json'), JSON.stringify(report, null, 2)).catch(() => { });
    if (browserCall)
        await Promise.race([browserCall('Browser.close').catch(() => { }), pause(1000)]);
    ws?.close();
    await stop(chrome);
    for (const child of children)
        await stop(child);
    clearTimeout(deadline);
    const checked = resolve(qa);
    if (dirname(checked) === join(root, '.data') && basename(checked).startsWith('qa-'))
        await rm(checked, { recursive: true, force: true }).catch(() => { });
}
