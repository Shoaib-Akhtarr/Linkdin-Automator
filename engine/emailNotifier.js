require('./envLoader');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

class EmailNotifier {
  constructor() {
    this.profile = this.loadProfile();
  }

  loadProfile() {
    try {
      const p = path.join(__dirname, '..', 'config', 'profile.json');
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch (e) {}
    return {};
  }

  getTransporter() {
    const user = process.env.EMAIL_USER || process.env.SMTP_USER || this.profile?.personal?.email || 'onlyshoaib158@gmail.com';
    const pass = process.env.EMAIL_PASS || process.env.SMTP_PASS || process.env.EMAIL_APP_PASSWORD;

    if (!pass) {
      return null;
    }

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    const secure = port === 465;

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass
      }
    });
  }

  /**
   * Generates a modern responsive HTML email body
   */
  generateHTML(report) {
    const { cycleTime, batchApplied, batchSkipped, totalAppliedToday, dailyLimit, appliedJobs = [] } = report;

    let jobRows = '';
    if (appliedJobs.length === 0) {
      jobRows = '<tr><td colspan="4" style="padding: 16px; text-align: center; color: #64748b;">No jobs were submitted in this cycle.</td></tr>';
    } else {
      jobRows = appliedJobs.map((j, i) => {
        const cvBadge = j.cvUsed && !j.cvUsed.includes('Default')
          ? `<span style="background: #e0e7ff; color: #3730a3; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">Custom ATS CV</span><br/><span style="font-size: 11px; color: #475569;">${j.cvUsed}</span>`
          : `<span style="background: #f1f5f9; color: #475569; padding: 3px 8px; border-radius: 4px; font-size: 11px;">Primary Profile CV</span>`;

        return `
          <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
            <td style="padding: 12px 10px; font-weight: 600; color: #0f172a;">${i + 1}. ${j.title}</td>
            <td style="padding: 12px 10px; color: #334155;"><strong>${j.company}</strong><br/><span style="color: #64748b; font-size: 12px;">${j.location || 'Remote'}</span></td>
            <td style="padding: 12px 10px;">${cvBadge}</td>
            <td style="padding: 12px 10px; color: #16a34a; font-weight: 500;">✓ Submitted</td>
          </tr>
        `;
      }).join('');
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; }
          .container { max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
          .header { background: linear-gradient(135deg, #0a66c2 0%, #004182 100%); color: #ffffff; padding: 24px; text-align: left; }
          .header h1 { margin: 0; font-size: 20px; font-weight: 700; }
          .header p { margin: 6px 0 0 0; opacity: 0.85; font-size: 13px; }
          .stats { display: flex; padding: 18px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
          .stat-card { flex: 1; text-align: center; }
          .stat-val { font-size: 22px; font-weight: 700; color: #0a66c2; }
          .stat-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; margin-top: 2px; }
          .content { padding: 24px; }
          .table { width: 100%; border-collapse: collapse; text-align: left; }
          .table th { background: #f1f5f9; padding: 10px; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 700; }
          .footer { background: #f8fafc; padding: 16px 24px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚀 LinkedIn 2-Hour Autopilot Summary</h1>
            <p>Cycle Completed: ${cycleTime}</p>
          </div>

          <table style="width: 100%; background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 16px 0;">
            <tr>
              <td style="text-align: center; width: 33%;">
                <div style="font-size: 22px; font-weight: 700; color: #16a34a;">${batchApplied}</div>
                <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Applied (Cycle)</div>
              </td>
              <td style="text-align: center; width: 33%; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
                <div style="font-size: 22px; font-weight: 700; color: #0a66c2;">${totalAppliedToday} / ${dailyLimit}</div>
                <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Today's Total</div>
              </td>
              <td style="text-align: center; width: 33%;">
                <div style="font-size: 22px; font-weight: 700; color: #64748b;">${batchSkipped}</div>
                <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Skipped</div>
              </td>
            </tr>
          </table>

          <div class="content">
            <h3 style="margin-top: 0; margin-bottom: 14px; font-size: 15px; color: #0f172a;">Jobs Applied In This Batch</h3>
            <table class="table">
              <thead>
                <tr>
                  <th>Job Title</th>
                  <th>Company & Location</th>
                  <th>CV Deployed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${jobRows}
              </tbody>
            </table>
          </div>

          <div class="footer">
            Automated by LinkedIn-Automator • Running 24/7 on GitHub Actions Cloud
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Send the email report
   */
  async sendReport(report) {
    const transporter = this.getTransporter();
    const recipient = process.env.EMAIL_TO || this.profile?.personal?.email || 'onlyshoaib158@gmail.com';
    const sender = process.env.EMAIL_USER || process.env.SMTP_USER || this.profile?.personal?.email || 'onlyshoaib158@gmail.com';

    if (!transporter) {
      console.log('ℹ️ [Email Notifier] EMAIL_APP_PASSWORD is not set. Email report was skipped.');
      console.log('👉 To enable automatic email reports, add EMAIL_APP_PASSWORD in GitHub Secrets.');
      return false;
    }

    try {
      const subject = `🎯 LinkedIn Autopilot Report: ${report.batchApplied} Jobs Applied (${new Date().toLocaleTimeString()})`;
      const html = this.generateHTML(report);

      // Check if there are tailored PDF attachments to attach
      const attachments = [];
      if (Array.isArray(report.appliedJobs)) {
        for (const job of report.appliedJobs) {
          if (job.cvUsed && job.cvUsed.endsWith('.pdf')) {
            const pdfPath = path.join(__dirname, '..', 'data', 'tailored_cvs', job.cvUsed);
            if (fs.existsSync(pdfPath) && attachments.length < 5) {
              attachments.push({
                filename: job.cvUsed,
                path: pdfPath
              });
            }
          }
        }
      }

      console.log(`📧 [Email Notifier] Sending 2-Hour report to ${recipient}...`);
      const info = await transporter.sendMail({
        from: `"LinkedIn Automator" <${sender}>`,
        to: recipient,
        subject,
        html,
        attachments
      });

      console.log(`✓ [Email Notifier] Email sent successfully! MessageId: ${info.messageId}`);
      return true;
    } catch (err) {
      console.error(`❌ [Email Notifier] Failed to send email: ${err.message}`);
      return false;
    }
  }
}

module.exports = new EmailNotifier();
