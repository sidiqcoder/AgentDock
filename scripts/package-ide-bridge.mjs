import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
// VSIX is an ordinary ZIP. Store entries directly, avoiding a packaging toolchain.
const root = path.resolve('.');
const extension = path.join(root, 'extensions/antigravity-bridge');
const manifest = JSON.parse(await readFile(path.join(extension, 'package.json'), 'utf8'));
const entries = [
  ['extension/package.json', await readFile(path.join(extension, 'package.json'))],
  ['extension/extension.cjs', await readFile(path.join(extension, 'extension.cjs'))],
  [
    'extension.vsixmanifest',
    Buffer.from(
      `<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${manifest.name}" Version="${manifest.version}" Publisher="${manifest.publisher}"/><DisplayName>${manifest.displayName}</DisplayName><Description xml:space="preserve">${manifest.description}</Description><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.85.0"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>`,
    ),
  ],
  [
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>',
    ),
  ],
];
function crc32(data) {
  let crc = -1;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
const records = [];
const central = [];
let offset = 0;
for (const [filename, data] of entries) {
  const name = Buffer.from(filename);
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  records.push(header, name, data);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(data.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += header.length + name.length + data.length;
}
const index = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(index.length, 12);
end.writeUInt32LE(offset, 16);
await mkdir('.data', { recursive: true });
const output = path.resolve('.data/agent-dock-antigravity-bridge.vsix');
await writeFile(output, Buffer.concat([...records, index, end]));
console.log(output);
