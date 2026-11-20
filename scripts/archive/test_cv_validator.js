const cvValidator = require('../engine/cvValidator');
const cvTailor = require('../engine/cvTailor');
const pdfRenderer = require('../engine/pdfRenderer');

async function testValidator() {
  console.log('=== TEST 1: VALIDATING AN AUTHENTIC TAILORED CV ===');
  const job = {
    title: 'AI Engineer (RAG & Multi-Agent)',
    company: 'ScaleAI',
    description: `
Requirements:
- Strong Python, FastAPI, and Docker skills.
- Experience building RAG pipelines with LangChain, LangGraph, and Qdrant.
    `
  };

  const authenticTailored = cvTailor.tailorProfile(job);
  const audit = cvValidator.validate(authenticTailored);

  console.log('Valid?:', audit.isValid);
  console.log('Verdict:', audit.verdict);
  console.log('Audit Score:', audit.auditScore + '/100');
  console.log('Skills Checked:', audit.checks.skills.checkedCount, '(Violations: ' + audit.checks.skills.violations.length + ')');
  console.log('Errors:', audit.errors);

  console.log('\n=== TEST 2: ADVERSARIAL TAMPERING DETECTION ===');
  // Intentionally tamper with the tailored model
  const tampered = JSON.parse(JSON.stringify(authenticTailored));
  
  // Tamper 1: Inject unverified skill into MLOps
  tampered.skills.mlopsAndCloud.unshift('Apache Airflow (Expert)');

  // Tamper 2: Add unverified tech to project techStack
  tampered.projects[0].techStack.push('Kubernetes');

  // Tamper 3: Add forbidden tool to summary prose
  tampered.summary += ' Extensive production experience managing Kafka event streams and Terraform infrastructure.';

  const tamperedAudit = cvValidator.validate(tampered);
  console.log('Tampered Valid?:', tamperedAudit.isValid, '(Expected: false)');
  console.log('Tampered Verdict:', tamperedAudit.verdict);
  console.log('Tampered Audit Score:', tamperedAudit.auditScore + '/100');
  console.log('Detected Violations:');
  tamperedAudit.errors.forEach((err, i) => console.log(`   [${i + 1}] ${err}`));

  console.log('\n=== TEST 3: AUTOMATED TRUTH HEALING / SANITIZATION ===');
  const { sanitized, audit: healedAudit } = cvValidator.sanitize(tampered);
  console.log('Contains Airflow in MLOps?:', sanitized.skills.mlopsAndCloud.includes('Apache Airflow (Expert)'), '(Expected: false)');
  console.log('Contains Kubernetes in project stack?:', sanitized.projects[0].techStack.includes('Kubernetes'), '(Expected: false)');
  console.log('Project Stack Restored:', sanitized.projects[0].techStack);
  console.log('Healed Valid?:', healedAudit.isValid);

  console.log('\n=== TEST 4: END-TO-END PDF RENDER WITH VALIDATION GATE ===');
  const pdfResult = await pdfRenderer.renderTailoredCV(job);
  console.log('✓ Output Path:', pdfResult.filePath);
  console.log('✓ Validation Attached?:', !!pdfResult.validation);
  console.log('✓ Validation Audit Score:', pdfResult.validation.auditScore + '/100');
  console.log('✓ Validation Verdict:', pdfResult.validation.verdict);
}

testValidator().catch(err => {
  console.error('Validator test error:', err);
  process.exit(1);
});
