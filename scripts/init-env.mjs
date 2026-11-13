import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const target = new URL('../.env', import.meta.url);
let content;
try {
    content = await readFile(target, 'utf8');
}
catch (error) {
    if (error.code !== 'ENOENT')
        throw error;
    content = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
}
for (const name of ['JWT_SECRET', 'PEER_SECRET']) {
    const pattern = new RegExp(`^${name}=(.*)$`, 'm'), match = content.match(pattern);
    if (!match)
        content += `\n${name}=${randomBytes(32).toString('hex')}\n`;
    else {
        const value = match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
        if (!value || value.startsWith('#') || value.includes('replace-with-') || value.includes('local-development-only'))
            content = content.replace(pattern, `${name}=${randomBytes(32).toString('hex')}`);
        else if (value.length < 32)
            throw new Error(`${name} hiện tại ngắn hơn 32 ký tự. Hãy thay secret thật và restart dịch vụ; script giữ nguyên giá trị đã cấu hình.`);
    }
}
await writeFile(target, content, { mode: 0o600 });
console.log('Đã chuẩn bị .env. Giữ nguyên các secret thật đã có; không in secret ra màn hình. Khởi động lại dịch vụ nếu cấu hình vừa thay đổi.');
