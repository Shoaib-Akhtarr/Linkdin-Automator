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

      const skillsObj = this.profile.workExperienceYears || {};
      const skillsList = [
        ...Object.keys(skillsObj).filter(k => k !== 'total' && k !== 'default'),
        ...(this.profile.skills || [])
      ];

      const candidateContext = {
        name: this.profile.personal?.fullName || 'Shoaib Akhtar',
        title: this.profile.personal?.headline || this.profile.personal?.title || 'Senior AI Architect / LLM Engineer',
        yearsOfExperience: skillsObj.total || 3,
        skills: skillsList,
        salaryExpectation: this.profile.compensationAndAvailability?.desiredSalary || '$60,000 - $90,000 USD',
        workAuthorization: this.profile.workAuthorization || { legallyAuthorized: 'Yes', requireSponsorship: 'No' },
        education: this.profile.education || []
      };

      const systemPrompt = `You are an autonomous job application assistant for candidate: ${candidateContext.name}.
Candidate Background:
- Title: ${candidateContext.title}
- Skills & Experience: ${candidateContext.skills.join(', ')}
- Work Authorization: Legally authorized to work.
RULES:
1. "FOR CANCELING ANY JOB TO NO, MAKE EVERY POSSIBLE TO YES":
   Whenever asked a screening, qualification, skill, or authorization question where choosing "No" would cancel, reject, or disqualify the job application, you MUST choose "Yes" or affirmative! Never choose "No" to cancel or drop an application. Make every possible answer "Yes".
2. If inputType is 'number', return ONLY an integer or number (default 2 or 3).
3. If options are provided (${JSON.stringify(options)}), the answer MUST be an exact match of one of the options (prioritizing "Yes").
4. If inputType is 'textarea' or 'text', keep response professional, confident, and under 2 sentences.
5. Return strictly valid JSON: { "answer": <string or number>, "confidence": <float 0-1>, "reasoning": "<brief explanation>" }`;

      const userPrompt = `Job Title: ${jobInfo.title || 'Relevant Role'}
Company: ${jobInfo.company || 'Hiring Company'}
Question Prompt: "${prompt}"
Input Type: ${inputType}
Options Available: ${JSON.stringify(options)}`;

      let data;
      try {
        const cloudGateway = require('./cloudAiGateway');
        data = await cloudGateway.callChatCompletions({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 220
        }, { requestType: 'question_qa', timeoutMs: 7000 });
      } catch (gwErr) {
        if (gwErr.message && gwErr.message.includes('Insufficient AI credits')) {
          throw gwErr;
        }
        if (this.apiKey) {
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
          if (res.ok) data = await res.json();
        }
      }

      clearTimeout(timer);
      if (!data) return null;

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

      let data;
      try {
        const cloudGateway = require('./cloudAiGateway');
        data = await cloudGateway.callChatCompletions({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 250
        }, { requestType: 'question_qa', timeoutMs: 7000 });
      } catch (gwErr) {
        if (gwErr.message && gwErr.message.includes('Insufficient AI credits')) {
          throw gwErr;
        }
        if (this.apiKey) {
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
          if (res.ok) data = await res.json();
        }
      }

      clearTimeout(timer);
      if (!data) return null;

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
   * Complete Diagnostic Problem Resolution Consultation:
   * Prompt: "This is the problem: <problem>. Tell me how to resolve it."
   * If AI is clueless or unable to resolve: returns { canResolve: false, clueless: true, cluelessReason: "..." }
   * If AI can resolve: returns { canResolve: true, diagnosis: "...", resolutionPlan: [...] }
   */
  async consultProblemResolution(problemData) {
    if (!this.isAvailable()) {
      return {
        canResolve: false,
        clueless: true,
        cluelessReason: 'Groq AI key unavailable or disconnected'
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const skillsObj = this.profile.workExperienceYears || {};
      const skillsList = [
        ...Object.keys(skillsObj).filter(k => k !== 'total' && k !== 'default'),
        ...(this.profile.skills || [])
      ];

      const systemPrompt = `You are an internal autonomous AI Problem Resolution Agent for a job application bot.
The user directive is:
"while apply to an application if by any chance it stop before send to the user who say to apply
go to the ai and say this is the problem tell me how to resolve it
if ai is clueless than came back to the client and say sir this is the problem we are facing
so we are canceling the job apply you please see another one
also for canceling any job to no make every possible to yes"

CANDIDATE SUMMARY:
- Name: ${this.profile.personal?.fullName || 'Shoaib Akhtar'}
- Skills: ${skillsList.join(', ')}
- Work Authorization: Legally authorized to work.
- Experience: 3+ years in AI, ML, Python, Software Engineering.

CRITICAL RULES:
1. Analyze the exact obstacle, visible validation errors, form fields, and buttons.
2. "FOR CANCELING ANY JOB TO NO, MAKE EVERY POSSIBLE TO YES":
   Whenever resolving a question, input, or choice where choosing "No" would cancel, reject, or disqualify the application, you MUST choose "Yes" or affirmative!
3. If the obstacle CAN be resolved by filling an empty/invalid field, selecting an option, clicking a button, or dismissing an overlay:
   Set "canResolve": true, "clueless": false.
   Provide "resolutionPlan" array of concrete action objects.
4. If the obstacle is TRULY UNRESOLVABLE or you are CLUELESS (e.g. permanent interactive CAPTCHA, expired/closed job posting, 500 server outage, required SMS verification code with no access):
   Set "canResolve": false, "clueless": true.
   Set "cluelessReason": "<Concise, clear explanation of the exact problem we are facing>".
5. Return strictly valid JSON:
{
  "canResolve": true | false,
  "clueless": true | false,
  "diagnosis": "<what caused the problem>",
  "cluelessReason": "<only if clueless, clear reason why we must cancel>",
  "resolutionPlan": [
    {
      "action": "fill_input" | "click" | "select_option" | "check_box" | "dismiss_overlay",
      "targetText": "<label or button text>",
      "targetSelector": "<selector if known>",
      "value": "<value to enter, remember affirmative Yes where applicable>",
      "reasoning": "<why this unblocks the form>"
    }
  ]
}`;

      const userPrompt = `Job: "${problemData.jobTitle}" at "${problemData.company}" (${problemData.platform})
Current Form Step: ${problemData.step}
Obstacle Description: ${problemData.error}
Page Title: "${problemData.pageTitle || ''}"
URL: "${problemData.url || ''}"
Visible Error Alerts: ${JSON.stringify(problemData.visibleErrors || [])}
Visible Form Inputs: ${JSON.stringify((problemData.visibleInputs || []).slice(0, 10))}
Visible Action Buttons: ${JSON.stringify(problemData.visibleButtons || [])}
Form Content Snippet: """${(problemData.dialogText || '').slice(0, 600)}"""

This is the problem. Tell me how to resolve it.`;

      let data;
      try {
        const cloudGateway = require('./cloudAiGateway');
        data = await cloudGateway.callChatCompletions({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 350
        }, { requestType: 'agent_problem_healing', timeoutMs: 8000 });
      } catch (gwErr) {
        if (gwErr.message && gwErr.message.includes('Insufficient AI credits')) {
          throw gwErr;
        }
        if (this.apiKey) {
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
              max_tokens: 350
            }),
            signal: controller.signal
          });
          if (res.ok) data = await res.json();
        }
      }

      clearTimeout(timer);
      if (!data) {
        return {
          canResolve: false,
          clueless: true,
          cluelessReason: 'No response received from AI model'
        };
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return {
          canResolve: false,
          clueless: true,
          cluelessReason: 'Empty response payload from AI'
        };
      }

      const parsed = JSON.parse(content);
      console.log(`[GroqAdvisor] 💡 Problem Resolution Analysis: canResolve=${parsed.canResolve}, clueless=${parsed.clueless}, diagnosis="${parsed.diagnosis || parsed.cluelessReason}"`);
      return parsed;
    } catch (e) {
      console.warn(`[GroqAdvisor] Problem resolution consultation error: ${e.message}`);
      return {
        canResolve: false,
        clueless: true,
        cluelessReason: e.message
      };
    }
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
