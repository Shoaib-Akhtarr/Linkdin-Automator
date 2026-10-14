const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

async function run() {
    const cvPath = path.join('C:', 'Users', 'mshoa', 'OneDrive', 'Desktop', "cv's with Ex", 'shoaib_akhtar_cv7_ai_engineer.pdf');
    if (!fs.existsSync(cvPath)) {
        console.log('Not found:', cvPath);
        return;
    }
    const buffer = fs.readFileSync(cvPath);
    const parser = new PDFParse({ data: buffer });
    const text = await parser.getText();
    console.log('=== EXTRACTED TEXT ===');
    console.log(text.text);
    await parser.destroy();
}

run().catch(console.error);
