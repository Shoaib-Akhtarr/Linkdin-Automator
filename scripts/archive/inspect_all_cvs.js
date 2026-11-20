const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

async function inspectAllCVs() {
  const dir = path.join('C:', 'Users', 'mshoa', 'OneDrive', 'Desktop', "cv's with Ex");
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));

  console.log(`Inspecting ${files.length} CVs in ${dir}:`);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const buffer = fs.readFileSync(fullPath);
    const parser = new PDFParse({ data: buffer });
    const textObj = await parser.getText();
    const text = textObj.text || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    console.log(`\n--- [${file}] ---`);
    console.log('Header lines:', lines.slice(0, 8).join(' | '));
    await parser.destroy();
  }
}

inspectAllCVs().catch(console.error);
