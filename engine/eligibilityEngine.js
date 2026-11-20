const fs = require('fs');
const path = require('path');

// 1. TOP GIANTS & FAMOUS UNICORNS BLACKLIST
// As strictly instructed: NEVER apply to top tech giants or massive unicorns.
// Only boutique startups, seed-stage companies, and small firms.
const GIANTS_BLACKLIST = new Set([
  'anthropic', 'openai', 'figma', 'stripe', 'notion', 'cohere', 'scaleai', 'scale-ai',
  'databricks', 'cloudflare', 'snowflake', 'gitlab', 'datadog', 'spotify', 'hubspot',
  'coinbase', 'crowdstrike', 'canva', 'postman', 'snyk', 'wiz', 'verkada', '1password',
  'miro', 'airtable', 'mongodb', 'elastic', 'kong', 'palantir', 'meta', 'google', 'amazon',
  'apple', 'microsoft', 'netflix', 'uber', 'lyft', 'airbnb', 'tiktok', 'bytedance',
  'quora', 'ziprecruiter', 'affirm', 'shield', 'anduril', 'andurilindustries', 'purestorage',
  'doordash', 'doordashusa', 'thenewyorktimes', 'point72', 'xai', 'lucidsoftware',
  'fal-ai', 'telus-digital', 'armadin', 'horizon3ai', 'swarmaero', 'brainco',
  'supabase', 'elevenlabs', 'posthog', 'planetscale', 'sentry', 'linear', 'vercel',
  'clickhouse', 'grafana-labs', 'togetherai', 'together ai', 'mistralai', 'replit',
  'contentful', 'sanity', 'storyblok', 'livekit', 'stream', 'ably', 'pusher',
  'cloudinary', 'uploadcare', 'paddle', 'airbyte', 'dagster-labs', 'prefect',
  'singlestore', 'oxide-computer-company', 'readme', 'stoplight', 'ironclad',
  'deepgram', 'assemblyai', 'gradient', 'qumulo', 'resend', 'inngest', 'chalk',
  'knock', 'loops', 'stytch', 'courier', 'growthbook', 'highlight-run', 'axiom',
  'better-stack', 'checkly', 'modal-labs', 'render', 'railway', 'fly-io',
  'weaviate', 'qdrant', 'chroma', 'neon', 'xata', 'turso', 'prisma', 'hasura',
  'daily', 'bytebase', 'tinybird', 'merge', 'codat', 'gitbook', 'thirdweb',
  'cern', 'unicef', 'duckduckgo', 'duck-duck-go', 'imc trading', 'imc-trading'
]);

const SENIOR_ROLE_RX = /\b(senior|sr\.?|staff|principal|lead|head of|director|vp|vice president|manager|architect|distinguished|chief)\b/i;
const ENTRY_ROLE_RX = /\b(junior|entry|entry-level|associate|intern|internship|graduate|new grad|fresher|trainee|apprentice|early career)\b/i;
const EXECUTIVE_ROLE_RX = /\b(principal|distinguished|director|vp|vice president|chief|head of)\b/i;
const GEO_EXCLUDE_RX = /\b(us\s*only|usa\s*only|canada\s*only|uk\s*only|remote\s*\(us\)|remote\s*us|us\s*work authorization|us\s*citizen|security clearance)\b/i;
const NOISE_RX = /no longer taking applications|seeking freelance|seeking work|who's hiring a|currently travelling|^location:|^apply here:/i;

class EligibilityEngine {
  constructor() {
    this.profileData = null;
  }

  /**
   * Load Candidate Profile dynamically from config/profile.json & data/profile.json
   * Completely profile-driven: works for ANY candidate or resume.
   */
  loadCandidateProfile() {
    let profile = {};
    let dataProfile = {};
    const configPath = path.resolve(__dirname, '..', 'config', 'profile.json');
    const dataPath = path.resolve(__dirname, '..', 'data', 'profile.json');

    try {
      if (fs.existsSync(configPath)) {
        profile = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (_) {}

    try {
      if (fs.existsSync(dataPath)) {
        dataProfile = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      }
    } catch (_) {}

    // 1. Candidate Full Name & Headline
    const fullName = profile.personal?.fullName || dataProfile.personal?.fullName || 'Candidate';
    const headline = profile.personal?.headline || dataProfile.personal?.targetTitle || profile.summary || '';

    // 2. Candidate Total Experience (Years)
    let totalYears = 2;
    if (typeof profile.workExperienceYears?.total === 'number') {
      totalYears = profile.workExperienceYears.total;
    } else if (typeof profile.workExperienceYears?.default === 'number') {
      totalYears = profile.workExperienceYears.default;
    } else if (typeof profile.workExperienceYears?.total === 'string') {
      totalYears = parseFloat(profile.workExperienceYears.total) || 2;
    } else if (Array.isArray(dataProfile.experience) && dataProfile.experience.length > 0) {
      totalYears = dataProfile.experience.length * 1.5;
    }

    // 3. Dynamic Seniority Tier:
    // junior: <= 2 years
    // mid: 2.1 to 4.9 years
    // senior: 5+ years
    let seniorityTier = 'junior';
    if (totalYears >= 5) {
      seniorityTier = 'senior';
    } else if (totalYears > 2) {
      seniorityTier = 'mid';
    }

    // 4. Extract Dynamic Skills Pool from Candidate Profile
    const skillsSet = new Set();
    if (profile.workExperienceYears && typeof profile.workExperienceYears === 'object') {
      for (const k of Object.keys(profile.workExperienceYears)) {
        if (k !== 'total' && k !== 'default') {
          skillsSet.add(k);
        }
      }
    }
    if (dataProfile.skills && typeof dataProfile.skills === 'object') {
      for (const cat of Object.keys(dataProfile.skills)) {
        const arr = dataProfile.skills[cat];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (typeof item === 'string') skillsSet.add(item);
            else if (item && item.name) skillsSet.add(item.name);
          }
        }
      }
    }

    // 5. Target Roles from settings.json or headline
    const targetRoles = [];
    try {
      const settingsPath = path.resolve(__dirname, '..', 'config', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (Array.isArray(s.search?.keywords)) {
          targetRoles.push(...s.search.keywords);
        }
      }
    } catch (_) {}

    // 6. Candidate Location / Country
    const country = profile.personal?.address?.country || profile.workAuthorization?.citizenship || 'Pakistan';

    return {
      fullName,
      headline,
      totalYears,
      seniorityTier,
      skills: Array.from(skillsSet),
      targetRoles,
      country
    };
  }

  /**
   * Check if a job title / description aligns with candidate's actual domain
   */
  isDomainMatch(title, desc, candidate) {
    const titleLower = (title || '').toLowerCase().trim();
    const descLower = (desc || '').toLowerCase();

    // Universal software engineering terms that match any tech candidate
    const universalTechRx = /\b(software|developer|engineer|fullstack|full-stack|full stack|backend|back-end|frontend|front-end|programmer|coder|tech lead|sdet|devops)\b/i;

    // Common non-technical/completely unrelated roles
    const nonTechRx = /\b(nurse|registered nurse|physician|doctor|dentist|dental|attorney|lawyer|paralegal|real estate agent|realtor|loan officer|mortgage broker|truck driver|forklift|warehouse worker|welder|plumber|electrician|cashier|retail associate|sales representative|account executive|customer service representative|receptionist|office manager|executive assistant)\b/i;

    // Check if candidate explicitly has this skill (e.g. if candidate has 'Sales' or 'Graphic Design' in their profile)
    const candidateHasSkill = candidate.skills.some(s => s.toLowerCase() === titleLower || titleLower.includes(s.toLowerCase()));

    if (nonTechRx.test(titleLower) && !candidateHasSkill) {
      return { match: false, reason: `Non-technical role unrelated to profile: "${title}"` };
    }

    // Check candidate target roles
    const targetRoleMatch = candidate.targetRoles.some(r => titleLower.includes(r.toLowerCase()) || r.toLowerCase().includes(titleLower));
    if (targetRoleMatch) return { match: true };

    // Check candidate headline match
    const headlineWords = candidate.headline.toLowerCase().split(/[\s|&,/-]+/).filter(w => w.length > 2);
    const headlineMatch = headlineWords.some(w => titleLower.includes(w));
    if (headlineMatch) return { match: true };

    // Check candidate skills match in title
    const skillInTitle = candidate.skills.some(s => {
      const sLower = s.toLowerCase();
      if (sLower.length < 3) return false;
      return titleLower.includes(sLower);
    });
    if (skillInTitle) return { match: true };

    // If it's a general software/engineering role, check if description has candidate skills
    if (universalTechRx.test(titleLower)) {
      const skillsInDesc = candidate.skills.filter(s => {
        const sLower = s.toLowerCase();
        if (sLower.length < 3) return false;
        return descLower.includes(sLower);
      });
      if (skillsInDesc.length > 0 || descLower.length < 100) {
        return { match: true };
      }
    }

    return {
      match: false,
      reason: `Domain mismatch: Job "${title}" does not overlap with candidate profile (${candidate.headline || candidate.skills.slice(0, 5).join(', ')})`
    };
  }

  /**
   * Evaluate eligibility dynamically against candidate profile
   */
  evaluateEligibility(job, settings = {}) {
    // Reload candidate profile dynamically so changes in profile.json / CV take immediate effect!
    const candidate = this.loadCandidateProfile();

    const desc = (job.description || '').toLowerCase();
    const title = (job.title || '').toLowerCase().trim();
    const comp = (job.company || '').toLowerCase().trim();
    const slug = (job.companySlug || '').toLowerCase().trim();
    const loc = (job.location || '').toLowerCase();
    const fullText = `${title} ${comp} ${loc} ${desc}`;

    // 0. NOISE FILTER
    if (NOISE_RX.test(title) || NOISE_RX.test(comp)) {
      return {
        eligible: false,
        reason: 'Noise / Non-job post',
        matchScore: 0,
        matchedSkills: []
      };
    }

    // 0.1 TOP GIANTS & FAMOUS UNICORNS BLACKLIST
    if (GIANTS_BLACKLIST.has(comp) || GIANTS_BLACKLIST.has(slug) || Array.from(GIANTS_BLACKLIST).some(b => comp.includes(b))) {
      return {
        eligible: false,
        reason: `Blacklisted Top/Unicorn Company: "${job.company}"`,
        matchScore: 0,
        matchedSkills: [],
        candidateSeniority: candidate.seniorityTier
      };
    }

    // 0.5. PROFILE-DRIVEN DYNAMIC SENIORITY FILTER
    if (settings.excludeSeniorLevels !== false) {
      if (candidate.seniorityTier === 'junior') {
        // Candidate has <= 2 years experience: disqualify Senior/Staff/Principal/Lead/Manager
        // UNLESS title explicitly indicates starter (junior, intern, new grad)
        if (SENIOR_ROLE_RX.test(title) && !ENTRY_ROLE_RX.test(title)) {
          return {
            eligible: false,
            reason: `Seniority Mismatch: Candidate has ${candidate.totalYears} yr(s) exp (Junior). Role requires Senior/Staff: "${job.title}"`,
            matchScore: 0,
            matchedSkills: [],
            candidateSeniority: candidate.seniorityTier
          };
        }
      } else if (candidate.seniorityTier === 'senior') {
        // Candidate has 5+ years experience: disqualify Intern, Junior, Entry Level, Apprentice!
        if (ENTRY_ROLE_RX.test(title) && !SENIOR_ROLE_RX.test(title)) {
          return {
            eligible: false,
            reason: `Seniority Mismatch: Candidate has ${candidate.totalYears} yr(s) exp (Senior). Role is Entry/Intern: "${job.title}"`,
            matchScore: 0,
            matchedSkills: [],
            candidateSeniority: candidate.seniorityTier
          };
        }
      } else if (candidate.seniorityTier === 'mid') {
        // Candidate has 3-4 years experience: disqualify Interns/Apprentice AND Executive/Principal/Director
        if (ENTRY_ROLE_RX.test(title)) {
          return {
            eligible: false,
            reason: `Seniority Mismatch: Candidate has ${candidate.totalYears} yr(s) exp (Mid-level). Role is Entry/Intern: "${job.title}"`,
            matchScore: 0,
            matchedSkills: [],
            candidateSeniority: candidate.seniorityTier
          };
        }
        if (EXECUTIVE_ROLE_RX.test(title)) {
          return {
            eligible: false,
            reason: `Seniority Mismatch: Candidate has ${candidate.totalYears} yr(s) exp (Mid-level). Role is Executive/Director: "${job.title}"`,
            matchScore: 0,
            matchedSkills: [],
            candidateSeniority: candidate.seniorityTier
          };
        }
      }
    }

    // 0.6. PROFILE-DRIVEN DYNAMIC DOMAIN FIT
    const domainCheck = this.isDomainMatch(job.title || '', job.description || '', candidate);
    if (!domainCheck.match) {
      return {
        eligible: false,
        reason: domainCheck.reason,
        matchScore: 0,
        matchedSkills: [],
        candidateSeniority: candidate.seniorityTier
      };
    }

    // 0.7. GEOGRAPHIC LOCK (Reject strict US/Canada/UK-only restrictions when candidate is not in that country)
    const isGloballyOpen = /worldwide|global|anywhere|apac|pakistan|work from anywhere/i.test(loc) || /worldwide|global|anywhere|pakistan/i.test(title);
    if (!isGloballyOpen && (GEO_EXCLUDE_RX.test(loc) || GEO_EXCLUDE_RX.test(title))) {
      return {
        eligible: false,
        reason: `Geographically Locked (Not open to ${candidate.country}): "${job.location}"`,
        matchScore: 0,
        matchedSkills: [],
        candidateSeniority: candidate.seniorityTier
      };
    }

    // Disqualifiers for Security clearance / Citizenship
    const config = settings.intelligence || {
      filterSecurityClearance: false,
      filterCitizenshipRestricted: false,
      minimumMatchScore: 0
    };

    if (config.filterSecurityClearance !== false) {
      const clearancePatterns = [
        /active.*(secret|top secret|ts\/sci|clearance)/i,
        /must (possess|have|hold|maintain).*(security|dod) clearance/i,
        /polygraph (required|examination)/i,
        /itar (clearance|compliance|restricted)/i
      ];

      for (const pat of clearancePatterns) {
        if (pat.test(fullText)) {
          return {
            eligible: false,
            reason: 'Requires Active Security Clearance / Polygraph',
            matchScore: 0,
            matchedSkills: [],
            candidateSeniority: candidate.seniorityTier
          };
        }
      }
    }

    if (config.filterCitizenshipRestricted !== false) {
      const citizenshipPatterns = [
        /must be a (us|u\.s\.|united states) citizen\b/i,
        /u\.s\. citizenship (is )?required/i,
        /us citizens? only\b/i,
        /no c2c|no corp-to-corp/i
      ];

      for (const pat of citizenshipPatterns) {
        if (pat.test(fullText)) {
          return {
            eligible: false,
            reason: 'Requires US Citizenship Only',
            matchScore: 0,
            matchedSkills: [],
            candidateSeniority: candidate.seniorityTier
          };
        }
      }
    }

    if (/commission only|100% commission|unpaid internship|volunteer position/i.test(fullText)) {
      return {
        eligible: false,
        reason: 'Unwanted job type (Commission only / Unpaid)',
        matchScore: 0,
        matchedSkills: [],
        candidateSeniority: candidate.seniorityTier
      };
    }

    // 4. EXTRACT MATCHING SKILLS DYNAMICALLY FROM CANDIDATE SKILLS POOL
    const matchedSkills = [];
    for (const skill of candidate.skills) {
      if (!skill || skill.length < 2) continue;
      const regex = new RegExp(`\\b${skill.replace(/[+.*^$?()[\]{}|\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(fullText)) {
        matchedSkills.push(skill);
      }
    }

    // 5. DETECT TIMEZONE PREFERENCE IN JD
    let detectedTimezone = null;
    if (/pacific time|pst|pdt/i.test(fullText)) detectedTimezone = 'Pacific Time (PST/PDT)';
    else if (/eastern time|est|edt/i.test(fullText)) detectedTimezone = 'Eastern Time (EST/EDT)';
    else if (/central time|cst|cdt/i.test(fullText)) detectedTimezone = 'Central Time (CST/CDT)';
    else if (/gmt|utc|bst/i.test(fullText)) detectedTimezone = 'GMT/BST';
    else if (/pkt|pakistan/i.test(fullText)) detectedTimezone = 'PKT (Pakistan Time)';

    // 6. DYNAMIC MATCH SCORE (0 - 100)
    const skillScore = Math.min(matchedSkills.length * 10, 70);
    const hasRoleInTitle = candidate.targetRoles.some(r => title.includes(r.toLowerCase())) ||
      candidate.skills.some(s => s.length > 2 && title.includes(s.toLowerCase()));
    const titleBonus = hasRoleInTitle ? 25 : 10;
    const matchScore = Math.min(skillScore + titleBonus, 100);

    return {
      eligible: true,
      matchScore,
      matchedSkills,
      detectedTimezone,
      candidateSeniority: candidate.seniorityTier,
      totalYears: candidate.totalYears
    };
  }

  /**
   * Generate a tailored cover letter / note specifically referencing candidate profile & job
   */
  generateTailoredCoverLetter(job, matchedSkills = []) {
    const candidate = this.loadCandidateProfile();
    const company = job.company || 'your team';
    const title = job.title || candidate.headline || 'Software Engineer';
    const topSkills = matchedSkills.slice(0, 3).join(', ') || candidate.skills.slice(0, 3).join(', ') || 'modern software engineering';

    return `Dear ${company} Hiring Team,\n\nI am thrilled to apply for the ${title} position. With ${candidate.totalYears}+ years of hands-on engineering experience designing and deploying scalable systems using ${topSkills}, I am confident in delivering immediate value to ${company}.\n\nI look forward to discussing how my technical background aligns with your engineering objectives.\n\nBest regards,\n${candidate.fullName}`;
  }
}

module.exports = new EligibilityEngine();
module.exports.EligibilityEngine = EligibilityEngine;
module.exports.GIANTS_BLACKLIST = GIANTS_BLACKLIST;
