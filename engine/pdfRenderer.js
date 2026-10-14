const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const cvTailor = require('./cvTailor');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

class PDFRenderer {
  constructor() {
    this.outputDir = path.resolve(__dirname, '..', 'data', 'tailored_cvs');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Sanitizes a string for safe filesystem filename
   * @param {string} str 
   * @returns {string}
   */
  sanitizeName(str) {
    if (!str) return 'General';
    return str
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 30)
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Dynamically generate an ATS-optimized PDF tailored specifically for the target job
   * @param {Object} jobInfo - { title, company, description, location }
   * @returns {Promise<{ filePath: string, fileName: string, tailoredData: Object }>}
   */
  async renderTailoredCV(jobInfo = {}) {
    const startTime = Date.now();
    const company = jobInfo.company || 'Company';
    const title = jobInfo.title || 'AI_Engineer';

    console.log(`📄 [CV Tailor] Synthesizing ATS-optimized resume for "${title}" at "${company}"...`);

    // 1. Tailor profile data and generate ATS HTML
    const tailoredData = cvTailor.tailorProfile(jobInfo);
    const htmlContent = cvTailor.generateATSHTML(tailoredData);

    // 2. Prepare file destination
    const safeCompany = this.sanitizeName(company);
    const safeTitle = this.sanitizeName(title);
    const fileName = `Shoaib_Akhtar_CV_${safeCompany}_${safeTitle}.pdf`;
    const outputPath = path.join(this.outputDir, fileName);

    // 3. Render HTML to vector PDF using Headless Chrome
    let browser = null;
    try {
      browser = await chromium.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
      });

      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'load' });

      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          bottom: '10mm',
          left: '12mm',
          right: '12mm'
        }
      });

      const elapsed = Date.now() - startTime;
      const fileSize = fs.statSync(outputPath).size;
      console.log(`✓ [CV Tailor] PDF generated in ${elapsed}ms (${fileSize} bytes) -> ${fileName}`);

      return {
        filePath: outputPath,
        fileName: fileName,
        fileSize: fileSize,
        tailoredData: tailoredData
      };
    } catch (err) {
      console.error('❌ [CV Tailor] Error rendering tailored PDF:', err.message);
      throw err;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}

module.exports = new PDFRenderer();
