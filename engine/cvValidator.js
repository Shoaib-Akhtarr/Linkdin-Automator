/**
 * CV Output Validator & Truth Verification Engine
 * 
 * Verifies that 100% of claims in any generated CV trace directly
 * back to the candidate's Single Source of Truth (data/profile.json).
 * 
 * Audits:
 * 1. Skills Whitelist: Zero unverified skills allowed on CV
 * 2. Project Invariance: Tech stacks must strictly match verified profile
 * 3. Experience & Credentials Invariance: Employers, roles, and degrees cannot be altered
 * 4. Forbidden Terms Scan: Deep text scan for unverified tools or hallucinations
 * 5. ATS Layout & Semantic Formatting: Validates single-column ATS structure and sections
 */

const fs = require('fs');
const path = require('path');
const masterProfile = require('./masterProfile');

class CVValidator {
  constructor(profile = masterProfile) {
    this.profile = profile;
  }

  loadSettings() {
    try {
      const p = path.join(__dirname, '..', 'config', 'settings.json');
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {}
    return {};
  }

  /**
   * Run full verification suite on tailored CV data
   * @param {Object} tailoredData - Tailored profile model from cvTailor
   * @returns {Object} Comprehensive audit report
   */
  validate(tailoredData) {
    if (!tailoredData || typeof tailoredData !== 'object') {
      return {
        isValid: false,
        verdict: 'FAILED',
        auditScore: 0,
        errors: ['Invalid or empty tailored data model provided']
      };
    }

    const errors = [];
    const warnings = [];

    // 1. Verify Skills Whitelist
    const skillsCheck = this.verifySkills(tailoredData);
    if (!skillsCheck.passed) {
      errors.push(...skillsCheck.violations);
    }

    // 2. Verify Project Tech Stacks
    const projectsCheck = this.verifyProjects(tailoredData);
    if (!projectsCheck.passed) {
      errors.push(...projectsCheck.violations);
    }

    // 3. Verify Experience & Credentials
    const credentialsCheck = this.verifyCredentials(tailoredData);
    if (!credentialsCheck.passed) {
      errors.push(...credentialsCheck.violations);
    }

    // 4. Scan for Forbidden / Unverified Skills in Text
    const textScanCheck = this.scanForbiddenTerms(tailoredData);
    if (!textScanCheck.passed) {
      errors.push(...textScanCheck.violations);
    }

    // 5. Verify ATS Semantic Structure
    const atsCheck = this.verifyATSStructure(tailoredData);
    if (!atsCheck.passed) {
      warnings.push(...atsCheck.warnings);
    }

    // Calculate Audit Score (0 - 100)
    let auditScore = 100;
    auditScore -= errors.length * 25;
    auditScore -= warnings.length * 5;
    auditScore = Math.max(0, Math.min(100, auditScore));

    const isValid = errors.length === 0;
    const verdict = isValid ? (warnings.length === 0 ? 'PASSED_PERFECT' : 'PASSED_WITH_WARNINGS') : 'FAILED_INTEGRITY_VIOLATION';

    return {
      isValid,
      verdict,
      auditScore,
      timestamp: new Date().toISOString(),
      checks: {
        skills: skillsCheck,
        projects: projectsCheck,
        credentials: credentialsCheck,
        textScan: textScanCheck,
        atsStructure: atsCheck
      },
      errors,
      warnings
    };
  }

  /**
   * Verify that every skill in the CV exists in the verified master profile
   */
  verifySkills(tailoredData) {
    const verifiedMasterList = this.profile.getAllVerifiedSkills().map(s => s.toLowerCase());
    const violations = [];
    let checkedCount = 0;

    const categories = ['languages', 'generativeAI', 'frameworks', 'mlopsAndCloud', 'dataScience'];

    for (const cat of categories) {
      const skillsInCat = tailoredData.skills?.[cat] || [];
      for (const skill of skillsInCat) {
        checkedCount++;
        const skillLower = skill.toLowerCase();
        const isVerified = verifiedMasterList.some(v => v === skillLower || skillLower.includes(v) || v.includes(skillLower));
        if (!isVerified) {
          violations.push(`Unverified skill detected in "${cat}": "${skill}" is not in candidate's verified profile.`);
        }
      }
    }

    return {
      passed: violations.length === 0,
      checkedCount,
      violations
    };
  }

  /**
   * Verify project names and ensure tech stacks have not been modified
   */
  verifyProjects(tailoredData) {
    const masterProjects = this.profile.projects || [];
    const verifiedMasterList = this.profile.getAllVerifiedSkills().map(s => s.toLowerCase());
    const violations = [];

    const tailoredProjects = tailoredData.projects || [];
    if (tailoredProjects.length === 0) {
      violations.push('CV contains 0 projects. At least 1 verified project is required.');
      return { passed: false, violations };
    }

    const settings = this.loadSettings();
    const allowDynamic = settings.intelligence?.dynamicProjects ?? true;

    for (const proj of tailoredProjects) {
      const original = masterProjects.find(p => p.name.toLowerCase() === (proj.name || '').toLowerCase());
      if (original) {
        // Original project: ensure techStack remains within verified skills
        const currStack = (proj.techStack || []).map(t => t.toLowerCase());
        for (const t of currStack) {
          const inMasterSkills = verifiedMasterList.some(v => v === t || t.includes(v) || v.includes(t));
          if (!inMasterSkills) {
            violations.push(`Project stack fabrication in "${proj.name}": "${t}" was added to techStack without verification.`);
          }
        }
      } else if (allowDynamic) {
        // Dynamically proposed project: check that techStack contains ONLY verified candidate skills
        const currStack = proj.techStack || [];
        if (currStack.length === 0) {
          violations.push(`Dynamic project "${proj.name}" has empty techStack.`);
          continue;
        }
        for (const t of currStack) {
          const isVerified = verifiedMasterList.some(v => v === t.toLowerCase() || t.toLowerCase().includes(v) || v.includes(t.toLowerCase()));
          if (!isVerified) {
            violations.push(`Dynamic project "${proj.name}" uses unverified technology: "${t}".`);
          }
        }
      } else {
        violations.push(`Fabricated project detected: "${proj.name}" does not exist in verified profile.`);
      }
    }

    return {
      passed: violations.length === 0,
      violations
    };
  }

  /**
   * Verify that company, education, and credentials remain authentic
   */
  verifyCredentials(tailoredData) {
    const violations = [];
    const raw = this.profile.raw || {};

    // Check company
    const exp = tailoredData.experience?.[0];
    const masterExp = raw.experience?.[0];
    if (!exp || exp.company !== masterExp?.company) {
      violations.push(`Employment record altered: Expected "${masterExp?.company}", found "${exp?.company}".`);
    }

    // Check education
    const edu = tailoredData.education?.[0];
    const masterEdu = raw.education?.[0];
    if (!edu || edu.institution !== masterEdu?.institution) {
      violations.push(`Education record altered: Expected "${masterEdu?.institution}", found "${edu?.institution}".`);
    }

    return {
      passed: violations.length === 0,
      violations
    };
  }

  /**
   * Deep scan full CV text for any unverified skills or hallucinated tools
   */
  scanForbiddenTerms(tailoredData) {
    const violations = [];
    const familiarSkills = this.profile.getAllFamiliarSkills().map(s => s.name);
    
    // Tools that candidate does NOT have verified and should never be claimed
    const forbiddenTools = [
      ...familiarSkills,
      'vLLM', 'Airflow', 'Kafka', 'Kubeflow', 'Terraform', 'Rust', 'Go'
    ];

    // Combine text from summary, experience bullets, and project bullets
    const textCorpus = [
      tailoredData.summary || '',
      ...(tailoredData.experience?.[0]?.bullets || []),
      ...(tailoredData.projects?.flatMap(p => p.bullets || []) || [])
    ].join(' ');

    for (const tool of forbiddenTools) {
      // Don't flag if tool is actually verified in master profile
      const isActuallyVerified = this.profile.getAllVerifiedSkills().some(s => s.toLowerCase() === tool.toLowerCase());
      if (isActuallyVerified) continue;

      const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}(?:$|[^a-zA-Z0-9_])`, 'i');
      if (regex.test(textCorpus)) {
        violations.push(`Forbidden unverified tool detected in CV prose: "${tool}" appears in summary or bullets.`);
      }
    }

    return {
      passed: violations.length === 0,
      violations
    };
  }

  /**
   * Check layout completeness, presence of placeholders, and ATS single-column compliance
   */
  verifyATSStructure(tailoredData) {
    const warnings = [];

    // Check personal info completeness
    const p = tailoredData.personal || {};
    if (!p.fullName) warnings.push('Missing full name in header.');
    if (!p.email) warnings.push('Missing email in header.');
    if (!p.phone) warnings.push('Missing phone in header.');

    // Check for artifact placeholders in visible CV fields
    const visibleData = {
      personal: tailoredData.personal,
      summary: tailoredData.summary,
      skills: tailoredData.skills,
      experience: tailoredData.experience,
      projects: tailoredData.projects,
      education: tailoredData.education,
      certifications: tailoredData.certifications
    };
    const textBlob = JSON.stringify(visibleData);
    if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(textBlob)) {
      warnings.push('Detected JavaScript artifact/placeholder (undefined/NaN) in visible CV fields.');
    }

    // Check summary length
    const summaryLen = (tailoredData.summary || '').length;
    if (summaryLen < 80) {
      warnings.push(`Professional summary may be too brief (${summaryLen} chars).`);
    } else if (summaryLen > 800) {
      warnings.push(`Professional summary may be too lengthy (${summaryLen} chars) for a 1-page ATS resume.`);
    }

    return {
      passed: warnings.length === 0,
      warnings
    };
  }

  /**
   * Validate and automatically sanitize any minor defects so execution never fails
   */
  sanitize(tailoredData) {
    const audit = this.validate(tailoredData);
    if (audit.isValid) {
      return { sanitized: tailoredData, audit };
    }

    console.warn(`🛡️ [CV Validator] Sanity violations found (${audit.errors.length}). Performing automated truth healing...`);

    const healed = JSON.parse(JSON.stringify(tailoredData));
    const verifiedMasterList = this.profile.getAllVerifiedSkills().map(s => s.toLowerCase());

    // 1. Sanitize skills: filter out any unverified items
    const categories = ['languages', 'generativeAI', 'frameworks', 'mlopsAndCloud', 'dataScience'];
    for (const cat of categories) {
      if (Array.isArray(healed.skills?.[cat])) {
        healed.skills[cat] = healed.skills[cat].filter(s =>
          verifiedMasterList.some(v => v === s.toLowerCase() || s.toLowerCase().includes(v) || v.includes(s.toLowerCase()))
        );
      }
    }

    // 2. Sanitize projects
    const settings = this.loadSettings();
    const allowDynamic = settings.intelligence?.dynamicProjects ?? true;
    const sanitizedProjects = [];

    for (const proj of healed.projects || []) {
      const original = this.profile.projects.find(p => p.name.toLowerCase() === (proj.name || '').toLowerCase());
      if (original) {
        sanitizedProjects.push({
          name: original.name,
          techStack: [...original.techStack],
          bullets: proj.bullets || original.bullets
        });
      } else if (allowDynamic && Array.isArray(proj.techStack) && proj.techStack.length > 0) {
        const validStack = proj.techStack.filter(t =>
          verifiedMasterList.some(v => v === t.toLowerCase() || t.toLowerCase().includes(v) || v.includes(t.toLowerCase()))
        );
        if (validStack.length >= 2) {
          sanitizedProjects.push({
            name: proj.name,
            techStack: validStack,
            bullets: proj.bullets || []
          });
        }
      }
    }

    if (sanitizedProjects.length > 0) {
      healed.projects = sanitizedProjects;
    } else {
      const cvTailor = require('./cvTailor');
      const targetJob = tailoredData.matchAnalysis?.job || { title: tailoredData.personal?.targetTitle || 'AI Engineer' };
      healed.projects = cvTailor.generateSuggestedProjects(targetJob);
    }

    // 3. Sanitize text prose if unverified tools were injected into summary or bullets
    if (!audit.checks.textScan.passed) {
      healed.summary = this.profile.summary;
      if (healed.experience?.[0] && this.profile.experience?.[0]) {
        healed.experience[0].bullets = [...this.profile.experience[0].bullets];
      }
    }

    // 4. Re-validate after healing
    const postAudit = this.validate(healed);
    return { sanitized: healed, audit: postAudit };
  }
}

module.exports = new CVValidator();
