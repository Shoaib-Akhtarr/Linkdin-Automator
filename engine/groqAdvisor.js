/**
 * Groq AI Autonomous Self-Healing Advisor
 * 
 * Provides real-time LLM intelligence when automation encounters obstacles:
 * 1. Obscured / Custom / Unrecognized Form Questions (Answers accurately via Candidate Profile)
 * 2. Unhandled Errors & Form Validation Blocks (Detects red banners & advises corrections)
 * 3. Stuck ATS Wizards (Identifies missing Next/Submit/Review CTAs from page layout)
 * 4. 0s Human-Wait Execution (Autonomous continuous recovery)
 */

const fs = require('fs');
const path = require('path');
require('./envLoader');

class GroqAdvisor {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY || '';
    this.model = 'qwen/qwen3.8-27b';
    this.timeoutMs = 12000;
    this.profile = this.loadProfile();
  }

  loadProfile() {
    try {
      const p = path.join(__dirname, '..', 'config', 'profile.json');
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch (_) {}
    return {};
  }

  isAvailable() {
    return Boolean(this.apiKey);
  }

  /**
   * Resolve an unknown or low-confidence form question using Groq and the candidate's master profile
   */
  async resolveQuestion(prompt, inputType = 'text', options = [], jobInfo = {}) {
    if (!this.isAvailable()) return null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const candidateContext = {
        name: this.profile.personal?.fullName || 'Shoaib Akhtar',
        title: this.profile.personal?.title || 'Senior AI Architect / LLM Engineer',
        yearsOfExperience: this.profile.workExperienceYears || 5,
        skills: this.profile.skills || [],
        salaryExpectation: this.profile.compensation?.desiredSalary || '$140,000 - $180,000 USD',
        workAuthorization: this.profile.workAuthorization || { legallyAuthorized: 'Yes', requireSponsorship: 'Yes' },
        education: this.profile.education || []
      };

      const systemPrompt = `You are an autonomous job application assistant for candidate: ${candidateContext.name}.
Answer the question accurately using ONLY candidate details.
RULES:
1. Never hallucinate skills not possessed.
2. If inputType is 'number', return ONLY an integer or number.
3. If options are provided (${JSON.stringify(options)}), the answer MUST be an exact match of one of the options.
4. If inputType is 'textarea' or 'text', keep response professional, confident, and under 2 sentences.
5. Return strictly valid JSON: { "answer": <string or number>, "confidence": <float 0-1>, "reasoning": "<brief explanation>" }`;

      const userPrompt = `Job Title: ${jobInfo.title || 'Relevant Role'}
Company: ${jobInfo.company || 'Hiring Company'}
Question Prompt: "${prompt}"
Input Type: ${inputType}
Options Available: ${JSON.stringify(options)}`;

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 220
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!res.ok) {
        console.warn(`[GroqAdvisor] API error: ${res.statusText}`);
        return null;
      }

      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content;
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (parsed && parsed.answer !== undefined) {
        return {
          answer: parsed.answer,
          confidence: parsed.confidence || 0.9,
          reasoning: `Groq AI Advisor: ${parsed.reasoning || 'Profile aligned'}`
        };
      }
    } catch (e) {
      console.warn(`[GroqAdvisor] Question resolution error: ${e.message}`);
    }
    return null;
  }

  /**
   * Diagnose a stuck ATS wizard, missing CTA, or validation error on the page
   */
  async adviseNextAction(page, errorContext) {
    if (!this.isAvailable()) return null;

    try {
      // 1. Scrape current page snapshot for Groq analysis
      const pageInfo = await page.evaluate(() => {
        // Collect visible buttons & clickable elements
        const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"]'))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
          })
          .map(el => ({
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '),
            id: el.id || '',
            className: el.className || '',
            type: el.type || '',
            role: el.getAttribute('role') || ''
          }))
          .filter(b => b.text.length > 0 && b.text.length < 60)
          .slice(0, 25);

        // Collect visible error banners or required notices
        const errorBanners = Array.from(document.querySelectorAll('.error, .alert, [role="alert"], [aria-invalid="true"], .invalid-feedback, .error-message'))
          .filter(el => el.innerText && el.innerText.trim().length > 0)
          .map(el => el.innerText.trim().replace(/\s+/g, ' '))
          .slice(0, 5);

        return {
          title: document.title || '',
          url: window.location.href,
          buttons,
          errorBanners
        };
      }).catch(() => null);

      if (!pageInfo) return null;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const systemPrompt = `You are an autonomous browser troubleshooting expert for job applications.
The automation is stuck or received an error. Analyze the page's visible buttons, error banners, and URL to determine the exact next recovery action.
Rules:
- If a button like 'Review', 'Next', 'Continue', 'Submit Application', 'Apply', or 'Proceed' exists, choose action 'click' with that button's text.
- If an error banner indicates a missing field, specify what needs fixing.
- Output strictly JSON:
{
  "action": "click" | "fix_field" | "reload" | "fail",
  "targetText": "<button or link text to click>",
  "targetSelector": "<suggested selector if any>",
  "reasoning": "<why this action will unblock the application>"
}`;

      const userPrompt = `Current Error / Obstacle: ${errorContext}
Page Title: "${pageInfo.title}"
Page URL: "${pageInfo.url}"
Visible Buttons: ${JSON.stringify(pageInfo.buttons)}
Visible Error Notices: ${JSON.stringify(pageInfo.errorBanners)}`;

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 250
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!res.ok) return null;
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      const advice = JSON.parse(content);
      console.log(`[GroqAdvisor] 💡 Self-Healing Advice: Action="${advice.action}", Target="${advice.targetText}", Reason="${advice.reasoning}"`);
      return advice;
    } catch (e) {
      console.warn(`[GroqAdvisor] Diagnostic error: ${e.message}`);
    }
    return null;
  }

  /**
   * Execute the advice provided by Groq
   */
  async executeAdvice(page, advice, update = () => {}) {
    if (!advice || !advice.action) return false;

    if (advice.action === 'click' && advice.targetText) {
      update(`💡 [Groq Self-Healing] Executing advised action: Click "${advice.targetText}"...`);
      // 1. Try getByRole button with accessible name
      const btnRole = page.getByRole('button', { name: new RegExp(advice.targetText, 'i') });
      if (await btnRole.count() > 0 && await btnRole.first().isVisible().catch(() => false)) {
        await btnRole.first().click({ force: true }).catch(() => {});
        return true;
      }
      // 2. Try link role
      const linkRole = page.getByRole('link', { name: new RegExp(advice.targetText, 'i') });
      if (await linkRole.count() > 0 && await linkRole.first().isVisible().catch(() => false)) {
        await linkRole.first().click({ force: true }).catch(() => {});
        return true;
      }
      // 3. Try standard text match
      const textEl = await page.$(`button:has-text("${advice.targetText}"), a:has-text("${advice.targetText}")`).catch(() => null);
      if (textEl && await textEl.isVisible().catch(() => false)) {
        await textEl.click({ force: true }).catch(() => {});
        return true;
      }
    }
    return false;
  }
}

module.exports = new GroqAdvisor();
