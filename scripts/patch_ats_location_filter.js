const fs = require('fs');
const path = require('path');

// 1. Patch companyAtsEngine.js: Remove place/city filter for remote jobs
const atsPath = path.join(__dirname, '..', 'engine', 'platforms', 'companyAtsEngine.js');
let atsCode = fs.readFileSync(atsPath, 'utf8');

const oldLocationFilter = `  passesLocationFilter(job, settings = {}) {
    const loc = (job.location || '').toLowerCase();
    const workplace = (job.workplaceType || '').toLowerCase();
    const country = (job.country || '').toLowerCase();
    const secondary = (job.secondaryLocations || []).map(s => s.toLowerCase()).join(' ');
    const allLocationText = \`\${loc} \${secondary} \${country}\`.toLowerCase();
    const desc = (job.description || '').toLowerCase();

    // 1. REJECT if workplaceType explicitly says Hybrid or On-Site
    if (workplace === 'hybrid' || workplace === 'onsite' || workplace === 'on-site') {
      return false;
    }

    // 2. REJECT if travel is required or physical office attendance / relocation
    if (/travel required|travel-required|in-person|in person|office based|relocation required/i.test(loc) ||
        /travel required|travel-required|relocation required/i.test(allLocationText)) {
      return false;
    }

    // 3. Positive Global / Worldwide Remote Indicators
    const isExplicitlyWorldwide = /worldwide|global|anywhere|work from anywhere|apac|emea|international|home based - worldwide|all locations/i.test(allLocationText) ||
                                 /work from anywhere|anywhere in the world|worldwide remote/i.test(desc.slice(0, 1000));

    // 4. Strict Regional / Country-Locked Indicators (Incompatible with candidate in Pakistan)
    const regionalLockedPatterns = [
      /\\bus[-\\s]?remote\\b/i,
      /\\bremote\\s+(?:in|within)\\s+(?:the\\s+)?(?:us|usa|united states)\\b/i,
      /\\b(?:us|usa|united states)\\s+only\\b/i,
      /\\bcanada[-\\s]?remote\\b/i,
      /\\bremote\\s+(?:in|within)\\s+canada\\b/i,
      /\\buk[-\\s]?remote\\b/i,
      /\\bremote\\s+(?:in|within)\\s+(?:the\\s+)?uk\\b/i,
      /\\bremote,\\s*united kingdom\\b/i,
      /\\blatam\\s+only\\b/i,
      /\\beurope\\s+only\\b/i,
      /\\bbelgrade\\b/i,
      /\\briyadh\\b/i,
      /\\bsydney\\b/i,
      /\\bmelbourne\\b/i,
      /\\btokyo\\b/i
    ];

    if (!isExplicitlyWorldwide) {
      for (const rx of regionalLockedPatterns) {
        if (rx.test(allLocationText) || rx.test(loc)) {
          return false;
        }
      }

      // Check strict physical tech hub cities without explicit global remote
      const strictCityBlockers = [
        'san francisco', 'seattle', 'new york', 'nyc', 'austin', 'boston',
        'chicago', 'los angeles', 'sunnyvale', 'mountain view', 'palo alto',
        'london', 'dublin', 'berlin', 'paris', 'toronto', 'vancouver'
      ];
      for (const city of strictCityBlockers) {
        if (allLocationText.includes(city)) {
          return false;
        }
      }
    }

    // 5. Check Legal & Visa / Citizenship Blockers in Description
    const citizenshipBlockers = [
      'us citizenship required',
      'u.s. citizenship required',
      'security clearance required',
      'must be a u.s. citizen',
      'must be a us citizen',
      'no visa sponsorship',
      'not open to international',
      'must reside in the united states',
      'must be located in the united states',
      'must be based in the us',
      'must be based in the united states'
    ];
    for (const b of citizenshipBlockers) {
      if (desc.includes(b)) {
        return false;
      }
    }

    // 6. Must have a confirmed remote indicator
    const isExplicitlyRemote = job.isRemote === true || workplace === 'remote' || isExplicitlyWorldwide;
    const hasRemoteWord = /remote|worldwide|global|anywhere|telecommute|home based/i.test(allLocationText);

    if (!isExplicitlyRemote && !hasRemoteWord) {
      return false;
    }

    return true;
  }`;

const newLocationFilter = `  /**
   * Filter 2: Pure Remote Viability Gate
   * Place/City/Country restrictions removed for remote roles — any verified remote job is accepted.
   * Only strictly rejects verified in-person/hybrid or mandatory relocation.
   */
  passesLocationFilter(job, settings = {}) {
    const loc = (job.location || '').toLowerCase();
    const workplace = (job.workplaceType || '').toLowerCase();
    const secondary = (job.secondaryLocations || []).map(s => s.toLowerCase()).join(' ');
    const allLocationText = \`\${loc} \${secondary} \${job.country || ''}\`.toLowerCase();
    const desc = (job.description || '').toLowerCase();

    // 1. REJECT only if workplaceType is explicitly Hybrid or On-Site
    if (workplace === 'hybrid' || workplace === 'onsite' || workplace === 'on-site') {
      return false;
    }

    // 2. REJECT if physical office presence or relocation is strictly mandatory
    if (/in-person only|100% on-site|office based only|mandatory relocation/i.test(loc) ||
        /in-person only|100% on-site|mandatory relocation/i.test(allLocationText)) {
      return false;
    }

    // 3. REJECT only if active military clearance/polygraph is explicitly demanded
    if (/active.*(secret|top secret|ts\\/sci|clearance)|polygraph required/i.test(desc)) {
      return false;
    }

    // 4. Remote Verification: accepts if marked remote, worldwide, or mentions remote in title/location/desc
    const isExplicitlyRemote = job.isRemote === true || workplace === 'remote';
    const hasRemoteWord = /remote|worldwide|global|anywhere|telecommute|home based|distributed/i.test(allLocationText) ||
                          /remote|work from home|work from anywhere/i.test(job.title || '') ||
                          /fully remote|100% remote|remote friendly|remote role|remote position/i.test(desc.slice(0, 1500));

    return isExplicitlyRemote || hasRemoteWord;
  }`;

if (atsCode.includes(oldLocationFilter)) {
  atsCode = atsCode.replace(oldLocationFilter, newLocationFilter);
  console.log('✅ Patched passesLocationFilter (LF)');
} else {
  const crlfOld = oldLocationFilter.replace(/\n/g, '\r\n');
  const crlfNew = newLocationFilter.replace(/\n/g, '\r\n');
  if (atsCode.includes(crlfOld)) {
    atsCode = atsCode.replace(crlfOld, crlfNew);
    console.log('✅ Patched passesLocationFilter (CRLF)');
  } else {
    // Regex fallback
    atsCode = atsCode.replace(
      /passesLocationFilter\([\s\S]*?return true;\s*\}/,
      newLocationFilter.trim()
    );
    console.log('✅ Patched passesLocationFilter (Regex match)');
  }
}

// Also update the telemetry scan log in companyAtsEngine.js
atsCode = atsCode.replace(
  /logCallback\(`🏁 Scan complete! \$\{matchedCount\} verified remote roles, \$\{newAlertsCount\} candidate alerts dispatched\.\`\);/,
  "logCallback(`🏁 Scan complete! ${matchedCount} NEW verified remote roles added (${atsData.jobs.length} total indexed in ATS database), ${newAlertsCount} alerts dispatched.`);"
);

fs.writeFileSync(atsPath, atsCode, 'utf8');
console.log('✅ companyAtsEngine.js updated successfully');
