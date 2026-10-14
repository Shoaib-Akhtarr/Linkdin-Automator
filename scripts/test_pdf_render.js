const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const cvTailor = require('../engine/cvTailor');

(async () => {
  try {
    console.log('Testing PDF generation...');
    const sampleJob = {
      title: 'Senior Generative AI & RAG Engineer',
      company: 'TechCorp AI',
      description: 'Looking for a Senior AI Engineer experienced in LangChain, LangGraph, Qdrant, vLLM, DeepEval, Docker, and FastAPI.'
    };

    const tailored = cvTailor.tailorProfile(sampleJob);
    const html = cvTailor.generateATSHTML(tailored);
    
    fs.mkdirSync('data/tailored_cvs', { recursive: true });
    const outPath = path.resolve('data', 'tailored_cvs', 'Shoaib_Akhtar_CV_TechCorpAI_AI_Engineer.pdf');

    // Method: Launch headless chromium to generate pure vector PDF
    console.log('Launching headless chromium for rendering...');
    const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        bottom: '10mm',
        left: '12mm',
        right: '12mm'
      }
    });
    await browser.close();

    console.log(`✓ PDF successfully generated! Size: ${fs.statSync(outPath).size} bytes at: ${outPath}`);
  } catch(e) {
    console.error('Error rendering PDF:', e);
  }
})();
