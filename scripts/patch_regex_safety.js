const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'engine', 'aiCvOptimizer.js');
let code = fs.readFileSync(filePath, 'utf8');

const insertBefore = '  validateAndSanitizeOutput(llmOutput, masterProfile, analysis) {';
const helper = [
  '  static isSkillInText(text, skill) {',
  '    if (!text || !skill || typeof skill !== "string") return false;',
  '    const cleanSkill = skill.trim();',
  '    if (cleanSkill.length < 2) return false;',
  '    const escaped = cleanSkill.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");',
  '    try {',
  '      const rx = new RegExp("(?:^|[^a-zA-Z0-9_])" + escaped + "(?:$|[^a-zA-Z0-9_])", "i");',
  '      return rx.test(text);',
  '    } catch (_) {',
  '      return text.toLowerCase().includes(cleanSkill.toLowerCase());',
  '    }',
  '  }',
  '',
  '  validateAndSanitizeOutput(llmOutput, masterProfile, analysis) {'
].join('\n');

if (!code.includes('static isSkillInText(')) {
  code = code.replace(insertBefore, helper);
}

// Replace unsafe new RegExp occurrences in validateAndSanitizeOutput
code = code.replace(
  /badSkill\.length > 2 && new RegExp\(`\\\\b\${badSkill}\\\\b`, 'i'\)\.test\(tailoredSummary\)/g,
  'AICvOptimizer.isSkillInText(tailoredSummary, badSkill)'
);

code = code.replace(
  /badSkill\.length > 2 && new RegExp\(`\\\\b\${badSkill}\\\\b`, 'i'\)\.test\(bullet\)/g,
  'AICvOptimizer.isSkillInText(bullet, badSkill)'
);

code = code.replace(
  /badSkill\.length > 2 && new RegExp\(`\\\\b\${badSkill}\\\\b`, 'i'\)\.test\(b\)/g,
  'AICvOptimizer.isSkillInText(b, badSkill)'
);

fs.writeFileSync(filePath, code, 'utf8');
console.log('✓ Successfully patched regex safety in engine/aiCvOptimizer.js');
