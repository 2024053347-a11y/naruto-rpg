// sync-to-card.cjs — 将新 regex JSON 写入角色卡 PNG
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const regexJson = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../dist/regex-正文-火影忍者-起物单文件版.json'), 'utf-8'));

// Copy to Downloads folder
fs.copyFileSync(
  path.join(__dirname, '../dist/regex-正文-火影忍者-起物单文件版.json'),
  path.join(__dirname, '../../忍者手记/regex-正文-忍者手记.json'));
console.log('[1/2] Regex synced to Downloads');

// Update PNG card ccv3 field only
const cardPath = path.join(__dirname, '../../SillyTavern/data/default-user/characters/忍者手记.png');
const png = fs.readFileSync(cardPath);

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

let pos = 8;
const chunks = [];
while (pos < png.length) {
  const ln = png.readUInt32BE(pos);
  chunks.push({
    type: png.slice(pos + 4, pos + 8).toString('ascii'),
    data: png.slice(pos + 8, pos + 8 + ln),
    crc: png.slice(pos + 8 + ln, pos + 12 + ln)
  });
  pos += 12 + ln;
}

for (const c of chunks) {
  if (c.type !== 'tEXt') continue;
  const n = c.data.indexOf(0);
  const key = c.data.slice(0, n).toString('latin1');
  if (key !== 'ccv3') continue;

  // Decode ccv3, update regex_scripts, re-encode
  const raw = c.data.slice(n + 1).toString('latin1');
  let card;
  try {
    card = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  } catch {
    try { card = JSON.parse(raw); } catch (e) {
      console.error('Cannot decode ccv3:', e.message);
      process.exit(1);
    }
  }

  if (!card.data) card.data = {};
  if (!card.data.extensions) card.data.extensions = {};
  card.data.extensions.regex_scripts = [{
    id: crypto.randomUUID(),
    scriptName: '正文-忍者手记',
    findRegex: '起物',
    replaceString: regexJson.replaceString,
    trimStrings: [], placement: [2], disabled: false,
    markdownOnly: true, promptOnly: false, runOnEdit: true,
    substituteRegex: false, minDepth: null, maxDepth: null
  }];

  const newCardStr = JSON.stringify(card, null, 2);
  const newB64 = Buffer.from(newCardStr, 'utf-8').toString('base64');
  c.data = Buffer.concat([Buffer.from('ccv3\x00', 'latin1'), Buffer.from(newB64, 'ascii')]);
  const ci = Buffer.concat([Buffer.from('tEXt', 'ascii'), c.data]);
  c.crc = Buffer.alloc(4);
  c.crc.writeUInt32BE(crc32(ci));
  break;
}

const result = [png.slice(0, 8)];
for (const c of chunks) {
  const lb = Buffer.alloc(4);
  lb.writeUInt32BE(c.data.length);
  result.push(lb, Buffer.from(c.type, 'ascii'), c.data, c.crc);
}
fs.writeFileSync(cardPath, Buffer.concat(result));
console.log('[2/2] PNG card updated');
