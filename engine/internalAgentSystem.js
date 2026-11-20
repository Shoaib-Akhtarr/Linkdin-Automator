/**
 * Internal Complete Agent System for Autonomous Job Applications
 * 
 * Responsibilities:
 * 1. Deep Exception & Obstacle Interception: Catches every DOM, Playwright, timing, validation,
 *    and navigation error that could stop an application before sending to the user or submitting.
 * 2. Real-Time AI Consultation: Formulates the exact diagnostic question:
 *    "This is the problem: <problem details>. Tell me how to resolve it."
 * 3. Autonomous Healing Execution: Carefully executes the AI's advised fixes with defensive
 *    try/catch blocks around every single action.
 * 4. Respectful Client Communication: When the AI is clueless or unable to resolve:
 *    "Sir, this is the problem we are facing: <reason>. So we are canceling the job apply, you please see another one."
 * 5. Affirmative Rule ("For canceling any job to no, make every possible to yes"):
 *    Forces affirmative ("Yes") options for all qualification, authorization, and screening questions
 *    to prevent applications from being rejected or canceled.
 */

const fs = require('fs');
const path = require('path');
const groqAdvisor = require('./groqAdvisor');
const questionEngine = require('./questionEngine');

class InternalAgentSystem {
  constructor() {
    this.maxHealingAttempts = 2;
    this.activeHealingSessions = new Map(); // jobId -> attemptCount
  }

  /**
   * Helper logger
   */
  log(onUpdate, msg, level = 'info') {
    if (typeof onUpdate === 'function') onUpdate(`[AgentSystem] ${msg}`);
    console.log(`[AgentSystem] [${level.toUpperCase()}] ${msg}`);
  }

  /**
   * Format the exact client cancellation message required by user directive:
   * "Sir, this is the problem we are facing: <problem>. So we are canceling the job apply, you please see another one."
   */
  formatClientMessage(problemDetail) {
    const cleanProblem = String(problemDetail || 'An unresolvable form obstacle was encountered')
      .replace(/^error:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `Sir, this is the problem we are facing: ${cleanProblem}. So we are canceling the job apply, you please see another one.`;
  }

  /**
   * Deep Form & Obstacle DOM Scraper:
   * Extracts visible errors, missing fields, available buttons, and active text for the AI.
   */
  async scrapeObstacleContext(page, dialog = null) {
    if (!page || page.isClosed()) {
      return {
        url: '',
        title: '',
        dialogText: 'Page closed or unreachable',
        visibleErrors: ['Browser page is closed or crashed'],
        visibleInputs: [],
        visibleButtons: []
      };
    }

    try {
      const scopeHandle = dialog || page;

      const context = await scopeHandle.evaluate((isDialog) => {
        const root = document.querySelector('dialog[open], [role="dialog"], [data-testid="dialog"], .jobs-easy-apply-modal') || document.body;

        // 1. Text snippet (up to 1200 chars)
        const rawText = (root ? root.innerText : '') || '';
        const dialogText = rawText.slice(0, 1200).replace(/\s+/g, ' ').trim();

        // 2. Visible inline validation errors
        const errorSelectors = [
          '.artdeco-inline-feedback--error',
          '[data-test-form-builder-error]',
          '.fb-form-element__error',
          '[role="alert"]',
          '.error',
          '.is-invalid',
          '[aria-invalid="true"]',
          '.field-error',
          'span.error',
          '.has-error'
        ];
        const errorNodes = Array.from(document.querySelectorAll(errorSelectors.join(', ')));
        const visibleErrors = errorNodes
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && (el.innerText || '').trim().length > 0;
          })
          .map(el => (el.innerText || '').trim().replace(/\s+/g, ' '))
          .slice(0, 6);

        // 3. Visible Form Inputs
        const inputNodes = Array.from(root.querySelectorAll('input, select, textarea'));
        const visibleInputs = inputNodes
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map(el => {
            const id = el.id || '';
            const name = el.name || '';
            const type = (el.type || el.tagName.toLowerCase()).toLowerCase();
            const val = (el.value || '').trim();
            const isInvalid = el.getAttribute('aria-invalid') === 'true' || el.classList.contains('is-invalid');
            const isRequired = el.required || el.getAttribute('aria-required') === 'true';

            // Find best label
            let labelText = '';
            if (id) {
              const lbl = document.querySelector(`label[for="${id}"]`);
              if (lbl) labelText = lbl.innerText.trim();
            }
            if (!labelText) {
              const parentLbl = el.closest('label');
              if (parentLbl) labelText = parentLbl.innerText.trim();
            }
            if (!labelText) {
              const grouping = el.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping, .fb-form-element, fieldset');
              if (grouping) {
                const header = grouping.querySelector('legend, [role="heading"], label, p, span.t-14');
                if (header) labelText = header.innerText.trim();
              }
            }
            if (!labelText) {
              labelText = el.getAttribute('aria-label') || el.placeholder || name;
            }

            return {
              id,
              name,
              type,
              label: (labelText || '').slice(0, 70),
              value: val.slice(0, 50),
              isRequired,
              isInvalid
            };
          })
          .slice(0, 15);

        // 4. Visible Action Buttons
        const buttonNodes = Array.from(root.querySelectorAll('button, a[role="button"], input[type="submit"], input[type="button"]'));
        const visibleButtons = buttonNodes
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map(el => ({
            text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '),
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            id: el.id || '',
            className: el.className || ''
          }))
          .filter(b => b.text.length > 0 && b.text.length < 50)
          .slice(0, 12);

        return {
          dialogText,
          visibleErrors,
          visibleInputs,
          visibleButtons
        };
      }, Boolean(dialog));

      return {
        url: page.url() || '',
        title: await page.title().catch(() => ''),
        ...context
      };
    } catch (err) {
      return {
        url: '',
        title: '',
        dialogText: 'Failed to extract DOM state',
        visibleErrors: [err.message],
        visibleInputs: [],
        visibleButtons: []
      };
    }
  }

  /**
   * Master Obstacle Handler & Self-Healing Loop:
   * Triggered whenever an application stops, hits an exception, or gets blocked before user review/submit.
   * 
   * @param {Object} params
   * @param {Page} params.page - Active Playwright page
   * @param {ElementHandle} params.dialog - Active modal/dialog element handle
   * @param {Object} params.jobInfo - Information on the job
   * @param {Error|string} params.error - Obstacle description or exception
   * @param {number} params.step - Current form step count
   * @param {string} params.platform - 'LinkedIn' | 'Universal ATS' | 'Workday' | 'Ashby' | 'Greenhouse'
   * @param {Function} params.onUpdate - Progress status callback
   * @param {Orchestrator} params.orchestrator - Reference to main orchestrator
   * @returns {Promise<{ resolved: boolean, canceled: boolean, clientMessage?: string, message?: string }>}
   */
  async handleObstacle({ page, dialog, jobInfo = {}, error, step = 1, platform = 'LinkedIn', onUpdate = () => {}, orchestrator = null }) {
    const errorText = (error && error.message) ? error.message : String(error || 'Application stopped before submission');
    const jobKey = jobInfo.jobId || `${jobInfo.company || 'Job'}_${jobInfo.title || 'Role'}`;
    const attempts = (this.activeHealingSessions.get(jobKey) || 0) + 1;
    this.activeHealingSessions.set(jobKey, attempts);

    this.log(onUpdate, `🛑 [Self-Healing Agent] Intercepted stop on step ${step} for "${jobInfo.title}": ${errorText}`, 'warn');

    // Circuit Breaker: Do not loop infinitely if already tried maximum healing cycles
    if (attempts > this.maxHealingAttempts) {
      this.log(onUpdate, `⚠️ Maximum self-healing attempts (${this.maxHealingAttempts}) exhausted. AI could not resolve the obstacle.`, 'warn');
      return await this.cancelAndNotifyClient({
        page,
        dialog,
        jobInfo,
        reason: `${errorText} (Healing attempts exhausted)`,
        onUpdate,
        orchestrator
      });
    }

    // 1. Gather rich DOM Context & Obstacle details
    this.log(onUpdate, '🔍 Gathering page DOM diagnostics, field states, and error alerts for AI consultation...');
    const domContext = await this.scrapeObstacleContext(page, dialog);

    const problemData = {
      jobTitle: jobInfo.title || 'Target Role',
      company: jobInfo.company || 'Company',
      platform,
      step,
      error: errorText,
      pageTitle: domContext.title,
      url: domContext.url,
      dialogText: domContext.dialogText,
      visibleErrors: domContext.visibleErrors.length > 0 ? domContext.visibleErrors : [errorText],
      visibleInputs: domContext.visibleInputs,
      visibleButtons: domContext.visibleButtons
    };

    // 2. Go to AI and say: "This is the problem. Tell me how to resolve it."
    this.log(onUpdate, `🤖 Asking AI: "This is the problem: ${errorText}. Tell me how to resolve it."`);

    let aiAdvice = null;
    try {
      aiAdvice = await groqAdvisor.consultProblemResolution(problemData);
    } catch (aiErr) {
      this.log(onUpdate, `AI consultation call note: ${aiErr.message}`, 'warn');
    }

    // 3. Evaluate AI Response: Is the AI Clueless or Unable to Resolve?
    if (!aiAdvice || aiAdvice.clueless === true || aiAdvice.canResolve === false || (!aiAdvice.resolutionPlan && !aiAdvice.actions)) {
      const cluelessReason = aiAdvice?.cluelessReason || aiAdvice?.diagnosis || errorText;
      this.log(onUpdate, `🛑 AI is clueless / unable to resolve this obstacle: "${cluelessReason}"`, 'warn');
      return await this.cancelAndNotifyClient({
        page,
        dialog,
        jobInfo,
        reason: cluelessReason,
        onUpdate,
        orchestrator
      });
    }

    // 4. AI provided a Resolution Plan! Execute with defensive programming
    const plan = aiAdvice.resolutionPlan || aiAdvice.actions || [];
    this.log(onUpdate, `💡 AI diagnosed: "${aiAdvice.diagnosis || 'Field or button adjustment needed'}". Executing ${plan.length} resolution step(s)...`);

    let executionSuccess = false;
    for (const actionItem of plan) {
      try {
        const actionResult = await this.executeAction(page, dialog, actionItem, onUpdate);
        if (actionResult) executionSuccess = true;
      } catch (actErr) {
        this.log(onUpdate, `Defensive action note: ${actErr.message}`, 'warn');
      }
    }

    // Small delay for DOM mutation and settle
    await new Promise(r => setTimeout(r, 1200));

    // 5. Verification: Did the action unblock the application?
    const postDom = await this.scrapeObstacleContext(page, dialog);
    const stillHasErrors = postDom.visibleErrors.length > 0;

    // Check if Next, Review, or Submit became clickable
    const hasNextOrSubmit = postDom.visibleButtons.some(b => 
      !b.disabled && /next|review|submit|apply|continue|save/i.test(b.text)
    );

    if (executionSuccess && (!stillHasErrors || hasNextOrSubmit)) {
      this.log(onUpdate, '✓ [Self-Healing Agent] Obstacle successfully resolved by AI guidance! Resuming application flow.', 'info');
      return { resolved: true, canceled: false, message: 'Resolved via AI Agent self-healing' };
    }

    // If still blocked after executing the plan:
    this.log(onUpdate, '⚠️ Obstacle still remains active after executing AI resolution plan.', 'warn');
    if (attempts < this.maxHealingAttempts) {
      this.log(onUpdate, '🔄 Retrying self-healing cycle with updated DOM state...');
      return await this.handleObstacle({
        page,
        dialog,
        jobInfo,
        error: new Error(`Remaining error: ${postDom.visibleErrors[0] || errorText}`),
        step,
        platform,
        onUpdate,
        orchestrator
      });
    }

    // If all attempts failed: come back to client and cancel
    return await this.cancelAndNotifyClient({
      page,
      dialog,
      jobInfo,
      reason: postDom.visibleErrors[0] || errorText,
      onUpdate,
      orchestrator
    });
  }

  /**
   * Execute a single resolution action prescribed by the AI with defensive exception handling
   */
  async executeAction(page, dialog, actionItem, onUpdate = () => {}) {
    if (!actionItem || !actionItem.action) return false;
    const scope = dialog || page;

    const action = actionItem.action.toLowerCase();
    const targetText = actionItem.targetText || '';
    const selector = actionItem.targetSelector || '';
    let val = actionItem.value !== undefined ? String(actionItem.value) : '';

    // RULE: "For canceling any job to no, make every possible to yes"
    if (/^no$/i.test(val) && !/convict|felon|terminated/i.test(targetText)) {
      val = 'Yes';
    }

    this.log(onUpdate, `🔧 [Agent Action] ${action}: Target="${targetText || selector}" Value="${val}"`);

    // CASE 1: FILL INPUT
    if (action === 'fill_input' || action === 'clear_and_fill' || action === 'fill') {
      let inputEl = null;
      if (selector) {
        inputEl = await scope.$(selector).catch(() => null);
      }
      if (!inputEl && targetText) {
        // Try locating by label
        const inputs = await scope.$$('input, textarea, select').catch(() => []);
        for (const inp of inputs) {
          const lbl = await inp.evaluate(el => {
            const p = el.closest('label') || el.closest('.fb-dash-form-element, fieldset, div');
            return p ? p.innerText : '';
          }).catch(() => '');
          if (lbl.toLowerCase().includes(targetText.toLowerCase())) {
            inputEl = inp;
            break;
          }
        }
      }

      if (inputEl) {
        await inputEl.scrollIntoViewIfNeeded().catch(() => {});
        await inputEl.click({ force: true }).catch(() => {});
        await inputEl.fill('').catch(() => {});
        await inputEl.fill(val || 'Yes').catch(() => {});
        await inputEl.evaluate((el, v) => {
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, val || 'Yes').catch(() => {});
        return true;
      }
    }

    // CASE 2: CLICK BUTTON OR LINK
    if (action === 'click' || action === 'click_button') {
      if (selector) {
        const btn = await scope.$(selector).catch(() => null);
        if (btn && await btn.isVisible().catch(() => false)) {
          await btn.click({ force: true }).catch(() => {});
          return true;
        }
      }
      if (targetText) {
        const btnLocator = scope.getByRole('button', { name: new RegExp(targetText, 'i') });
        if (await btnLocator.count().catch(() => 0) > 0) {
          await btnLocator.first().click({ force: true }).catch(() => {});
          return true;
        }
        const textBtn = await scope.$(`button:has-text("${targetText}"), a:has-text("${targetText}")`).catch(() => null);
        if (textBtn && await textBtn.isVisible().catch(() => false)) {
          await textBtn.click({ force: true }).catch(() => {});
          return true;
        }
      }
    }

    // CASE 3: SELECT DROPDOWN OPTION
    if (action === 'select_option' || action === 'select') {
      const selects = await scope.$$('select').catch(() => []);
      for (const sel of selects) {
        const isMatched = !targetText || await sel.evaluate((el, t) => {
          const l = el.closest('label') || el.parentElement;
          return (l ? l.innerText : '').toLowerCase().includes(t.toLowerCase());
        }, targetText).catch(() => false);

        if (isMatched) {
          const targetVal = val || 'Yes';
          await sel.selectOption({ label: targetVal }).catch(async () => {
            await sel.selectOption({ value: targetVal }).catch(() => {});
          });
          return true;
        }
      }
    }

    // CASE 4: CHECKBOX / RADIO (Enforce Yes)
    if (action === 'check_box' || action === 'check' || action === 'select_radio') {
      const radiosAndChecks = await scope.$$('input[type="checkbox"], input[type="radio"], div[role="checkbox"], div[role="radio"]').catch(() => []);
      for (const el of radiosAndChecks) {
        const label = await el.evaluate(e => {
          const p = e.closest('label') || e.parentElement;
          return p ? p.innerText : '';
        }).catch(() => '');

        if (/yes/i.test(label) || (targetText && label.toLowerCase().includes(targetText.toLowerCase()))) {
          await el.scrollIntoViewIfNeeded().catch(() => {});
          await el.click({ force: true }).catch(() => {});
          return true;
        }
      }
    }

    // CASE 5: DISMISS OVERLAY
    if (action === 'dismiss_overlay' || action === 'close_overlay') {
      const closeBtn = await page.$('.artdeco-modal__dismiss, button[aria-label="Dismiss"], button[aria-label="Close"], #onetrust-accept-btn-handler').catch(() => null);
      if (closeBtn && await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click({ force: true }).catch(() => {});
        return true;
      }
    }

    return false;
  }

  /**
   * Cancel the application and communicate to the client with the exact phrase:
   * "Sir, this is the problem we are facing: <reason>. So we are canceling the job apply, you please see another one."
   */
  async cancelAndNotifyClient({ page, dialog, jobInfo = {}, reason, onUpdate = () => {}, orchestrator = null }) {
    const clientMessage = this.formatClientMessage(reason);

    // 1. Log with high visibility
    this.log(onUpdate, `📢 [Client Notification] ${clientMessage}`, 'warn');

    // 2. Broadcast via Orchestrator SSE events to dashboard and logs
    if (orchestrator) {
      orchestrator.log(clientMessage, 'warn');
      orchestrator.emit('client_message', {
        message: clientMessage,
        reason,
        job: jobInfo,
        timestamp: new Date().toLocaleTimeString()
      });
    }

    // 3. Cleanly dismiss modal or close external tab to reset browser cleanly
    await this.cleanDismissModal(page, dialog).catch(() => {});

    return {
      status: 'canceled',
      resolved: false,
      canceled: true,
      clientMessage,
      message: clientMessage,
      reason
    };
  }

  /**
   * Cleanly dismiss and discard the modal to ensure no hanging dialogs block the next job
   */
  async cleanDismissModal(page, dialog = null) {
    if (!page || page.isClosed()) return;
    try {
      const scope = dialog || page;
      const dismissBtn = await scope.$('button[aria-label="Dismiss"], button:has-text("Dismiss"), button.artdeco-modal__dismiss').catch(() => null);
      if (dismissBtn && await dismissBtn.isVisible().catch(() => false)) {
        await dismissBtn.click({ force: true }).catch(() => {});
        await new Promise(r => setTimeout(r, 600));

        const discardBtn = await page.$('button:has-text("Discard"), button[data-control-name="discard_application_confirm_btn"]').catch(() => null);
        if (discardBtn && await discardBtn.isVisible().catch(() => false)) {
          await discardBtn.click({ force: true }).catch(() => {});
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (_) {}
  }
}

module.exports = new InternalAgentSystem();
