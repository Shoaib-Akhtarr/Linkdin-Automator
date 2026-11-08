/**
 * Semantic Resolver: Accessibility Tree (a11y) Hybrid Fallback Engine
 * 
 * Activated whenever standard DOM selectors fail to locate application elements.
 * Uses W3C Accessible Roles and Computed Names to resolve live interactable handles.
 */

class SemanticResolver {
  /**
   * Universal Apply Button Resolver:
   * Falls back to Accessibility Tree when CSS/DOM cannot find the Apply CTA.
   */
  async resolveApplyButton(page) {
    if (!page || page.isClosed()) return null;

    // 1. Try semantic button role with common Apply phrases
    const applyPatterns = [
      /apply on company website/i,
      /apply on company site/i,
      /apply for this job/i,
      /apply now/i,
      /^apply$/i,
      /easy apply/i,
      /apply/i
    ];

    for (const pattern of applyPatterns) {
      try {
        const btnLocator = page.getByRole('button', { name: pattern });
        const count = await btnLocator.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const handle = await btnLocator.nth(i).elementHandle().catch(() => null);
          if (handle && await handle.isVisible().catch(() => false)) {
            return handle;
          }
        }
      } catch (_) {}

      try {
        const linkLocator = page.getByRole('link', { name: pattern });
        const count = await linkLocator.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const handle = await linkLocator.nth(i).elementHandle().catch(() => null);
          if (handle && await handle.isVisible().catch(() => false)) {
            return handle;
          }
        }
      } catch (_) {}
    }

    return null;
  }

  /**
   * Universal Form Liveness Check via Accessibility Tree:
   * Called when DOM reports "no form fields found".
   * Scans accessibility tree for semantic form inputs (textboxes, comboboxes, checkboxes).
   */
  async areFormFieldsSemanticallyOpen(page) {
    if (!page || page.isClosed()) return false;
    try {
      const currentUrl = (page.url() || '').toLowerCase();
      // Job aggregators and board listing pages are NEVER application forms
      if (currentUrl.includes('remoteok.com') || currentUrl.includes('jobicy.com') || 
          currentUrl.includes('weworkremotely.com') || currentUrl.includes('remotive.com') ||
          currentUrl.includes('linkedin.com/jobs')) {
        return false;
      }

      if (typeof page.ariaSnapshot === 'function') {
        const snapshot = await page.ariaSnapshot().catch(() => '');
        if (!snapshot) return false;

        const hasFileInput = snapshot.includes('file') || snapshot.includes('Upload') || snapshot.includes('Resume') || snapshot.includes('CV');
        const hasEmail = snapshot.includes('Email') || snapshot.includes('email');
        const hasName = snapshot.includes('Name') || snapshot.includes('name');
        const hasSubmit = snapshot.includes('Submit') || snapshot.includes('Apply');

        return (hasEmail || hasName) && (hasFileInput || hasSubmit);
      }

      // Fallback locator count: must have candidate contact input and file/submit
      const hasEmailInput = (await page.$('input[type="email"], input[name*="email" i]').catch(() => null)) !== null;
      const hasFileInput = (await page.$('input[type="file"]').catch(() => null)) !== null;
      const hasSubmit = (await page.$('button[type="submit"], input[type="submit"]').catch(() => null)) !== null;
      return hasEmailInput && (hasFileInput || hasSubmit);
    } catch (_) {
      return false;
    }
  }

  /**
   * Action Button Semantic Resolver (Next / Submit / Continue):
   * Resolves wizard buttons when CSS classes or custom tags are obfuscated.
   */
  async resolveActionButton(page, type = 'next') {
    if (!page || page.isClosed()) return null;

    const patterns = type === 'next'
      ? [/next/i, /save & continue/i, /save and continue/i, /continue/i, /proceed/i, /forward/i]
      : [/submit application/i, /complete application/i, /send application/i, /^submit$/i, /review and submit/i];

    for (const pattern of patterns) {
      try {
        const locator = page.getByRole('button', { name: pattern });
        const count = await locator.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const handle = await locator.nth(i).elementHandle().catch(() => null);
          if (handle && await handle.isVisible().catch(() => false)) {
            return handle;
          }
        }
      } catch (_) {}
    }

    return null;
  }

  /**
   * Input Field Semantic Resolver:
   * Finds a live input handle using its computed accessible name.
   */
  async resolveInputField(page, namePattern, role = 'textbox') {
    if (!page || page.isClosed()) return null;
    try {
      const locator = page.getByRole(role, { name: namePattern });
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const handle = await locator.nth(i).elementHandle().catch(() => null);
        if (handle && await handle.isVisible().catch(() => false)) {
          return handle;
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Capture a diagnostic semantic snapshot of the page.
   */
  async getSemanticSnapshot(page) {
    if (!page || page.isClosed()) return '';
    try {
      if (typeof page.ariaSnapshot === 'function') {
        return await page.ariaSnapshot().catch(() => '');
      }
    } catch (_) {}
    return '';
  }
}

module.exports = new SemanticResolver();
