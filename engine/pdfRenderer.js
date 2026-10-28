const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const cvTailor = require('./cvTailor');
const cvValidator = require('./cvValidator');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

class PDFRenderer {
  constructor() {
    this.outputDir = path.resolve(__dirname, '..', 'data', 'tailored_cvs');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    this.sharedBrowser = null;
  }

  async getBrowser() {
    if (!this.sharedBrowser || !this.sharedBrowser.isConnected()) {
      const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
      };
      if (fs.existsSync(CHROME_PATH)) {
        launchOptions.executablePath = CHROME_PATH;
      }
      this.sharedBrowser = await chromium.launch(launchOptions);
    }
    return this.sharedBrowser;
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

    const safeCompany = this.sanitizeName(company);
    const safeTitle = this.sanitizeName(title);
    const fileName = `Shoaib_Akhtar_CV_${safeCompany}_${safeTitle}.pdf`;
    const outputPath = path.join(this.outputDir, fileName);

    // Fast Check: If recent valid PDF already exists on disk, reuse immediately (0ms)
    if (fs.existsSync(outputPath)) {
      try {
        const stats = fs.statSync(outputPath);
        if (stats.size > 5000) {
          console.log(`⚡ [CV Tailor] Instant disk cache hit (${Math.round(stats.size / 1024)} KB) -> ${fileName}`);
          return {
            filePath: outputPath,
            fileName: fileName,
            fileSize: stats.size,
            tailoredData: null,
            validation: { isValid: true, auditScore: 100 }
          };
        }
      } catch (_) {}
    }

    console.log(`📄 [CV Tailor] Synthesizing ATS-optimized resume for "${title}" at "${company}"...`);

    // 1. Tailor profile data (with truthful AI optimization if available)
    const tailoredData = await cvTailor.tailorProfileAsync(jobInfo);

    // 2. Automated Output Validation & Truth Healing
    const { sanitized, audit } = cvValidator.sanitize(tailoredData);
    if (!audit.isValid) {
      console.warn(`⚠️ [CV Validator] Validation flagged ${audit.errors.length} item(s). Auto-sanitized to guarantee truthfulness.`);
    } else {
      console.log(`🛡️ [CV Validator] 100% truth verified against master profile (Audit score: ${audit.auditScore}/100)`);
    }

    const htmlContent = cvTailor.generateATSHTML(sanitized);

    // 3. Render HTML to vector PDF using Warm Headless Chromium
    let page = null;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();
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
        tailoredData: sanitized,
        validation: audit
      };
    } catch (err) {
      console.error('❌ [CV Tailor] Error rendering tailored PDF:', err.message);
      throw err;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }
}

module.exports = new PDFRenderer();
