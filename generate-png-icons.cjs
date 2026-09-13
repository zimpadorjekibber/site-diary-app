const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function generate() {
  const svgPath = path.join(__dirname, 'public', 'icon.svg');
  const svgBuffer = fs.readFileSync(svgPath);

  // 192x192 PNG
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(__dirname, 'public', 'icon-192.png'));
  console.log('Created icon-192.png');

  // 512x512 PNG
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(__dirname, 'public', 'icon-512.png'));
  console.log('Created icon-512.png');

  // Maskable icon (with safe padding for Android adaptive icons)
  await sharp(svgBuffer)
    .resize(410, 410)
    .extend({
      top: 51,
      bottom: 51,
      left: 51,
      right: 51,
      background: '#0c0f17'
    })
    .png()
    .toFile(path.join(__dirname, 'public', 'icon-maskable.png'));
  console.log('Created icon-maskable.png');
}

generate().catch(err => {
  console.error(err);
  process.exit(1);
});
