const fs = require('fs');
const path = require('path');
const eligibilityEngine = require('./eligibilityEngine');

class QuestionEngine {
  constructor(profilePath) {
    this.profilePath = profilePath || path.join(__dirname, '..', 'config', 'profile.json');
    this.profile = this.loadProfile();
  }

  loadProfile() {
    try {
      if (fs.existsSync(this.profilePath)) {
        return JSON.parse(fs.readFileSync(this.profilePath, 'utf-8'));
      }
    } catch (e) {
      console.error('Error loading profile:', e);
    }
    return {};
  }

  reloadProfile() {
    this.profile = this.loadProfile();
  }

  /**
   * Determine the best answer for a given question prompt and input type
   * @param {string} prompt - The question label or placeholder
   * @param {string} inputType - 'text' | 'number' | 'radio' | 'select' | 'checkbox' | 'textarea'
   * @param {Array<string>} options - Available options if radio or select
   * @param {Object} jobInfo - Details and full description of the job
   * @returns {{ answer: any, confidence: number, reasoning: string }}
   */
  evaluateQuestion(prompt, inputType = 'text', options = [], jobInfo = {}) {
    if (!prompt) {
      return { answer: '', confidence: 0, reasoning: 'Empty prompt' };
    }

    const cleanPrompt = prompt.toLowerCase().trim();
    const skills = this.profile.workExperienceYears || {};

    // 0. YES/NO QUESTIONS PRE-CHECK (e.g. "Do you have 2+ years of experience in Python?")
    const isYesNoOptions = options.length === 2 && options.some(o => /^yes$/i.test(o)) && options.some(o => /^no$/i.test(o));
    if (isYesNoOptions) {
      if (/convicted|felony|terminated|fired|require.*visa|require.*sponsorship/i.test(cleanPrompt)) {
        const needSponsorship = this.profile.workAuthorization?.requireSponsorship === 'Yes';
        if (/visa|sponsorship/i.test(cleanPrompt)) {
          return { answer: needSponsorship ? 'Yes' : 'No', confidence: 0.95, reasoning: 'Sponsorship Yes/No' };
        }
        return { answer: 'No', confidence: 0.95, reasoning: 'Disqualifier -> No' };
      }
      // Any questions asking about skills, experience, qualifications, comfort, remote, legally authorized
      return { answer: this.matchOption('Yes', options), confidence: 0.95, reasoning: 'Qualification Yes/No confirmation -> Yes' };
    }

    // 1. YEARS / MONTHS OF EXPERIENCE & DURATION
    if (/months?.*(experience|exp)|additional months/i.test(cleanPrompt)) {
      const monthsAns = options.length > 0 ? (this.matchOption('0', options) || this.matchOption('6', options) || options[0]) : '0';
      return { answer: monthsAns, confidence: 0.9, reasoning: 'Additional months of experience -> 0' };
    }

    if (/years?.*(experience|exp)|how many years|how long|years of work|duration|tenure|professional experience/i.test(cleanPrompt)) {
      let matchedYears = null;
      let matchedReason = '';

      // Find matching skill in profile
      for (const [skill, years] of Object.entries(skills)) {
        if (skill.toLowerCase() === 'default' || skill.toLowerCase() === 'total') continue;
        const regex = new RegExp(`\\b${skill.toLowerCase().replace('+', '\\+')}\\b`, 'i');
        if (regex.test(cleanPrompt)) {
          matchedYears = years;
          matchedReason = `Matched skill '${skill}' with ${years} years`;
          break;
        }
      }

      // Check general / software engineering experience
      if (matchedYears === null && /software|developer|engineering|programming|overall|total|professional/i.test(cleanPrompt)) {
        matchedYears = skills.total || 2;
        matchedReason = `Matched total experience: ${matchedYears} years`;
      }

      // Fallback years for unmatched skill
      if (matchedYears === null) {
        matchedYears = skills.default || 2;
        matchedReason = `Default experience fallback: ${matchedYears} years`;
      }

      if (inputType === 'number') {
        return { answer: matchedYears, confidence: 0.9, reasoning: matchedReason };
      }

      if (options.length > 0) {
        const bestOpt = this.matchOption(String(matchedYears), options);
        return { answer: bestOpt, confidence: 0.9, reasoning: `${matchedReason} -> matched option "${bestOpt}"` };
      }

      return { answer: String(matchedYears), confidence: 0.9, reasoning: matchedReason };
    }

    // 2. SPONSORSHIP QUESTIONS
    if (/sponsorship|require.*visa|visa.*sponsorship|require.*sponsorship/i.test(cleanPrompt)) {
      const needSponsorship = this.profile.workAuthorization?.requireSponsorship === 'Yes';
      const targetAnswer = needSponsorship ? 'Yes' : 'No';
      return {
        answer: this.matchOption(targetAnswer, options) || targetAnswer,
        confidence: 0.95,
        reasoning: `Sponsorship rule -> ${targetAnswer}`
      };
    }

    // 3. WORK AUTHORIZATION
    if (/authorized to work|legal.*authorization|legally authorized|eligible to work/i.test(cleanPrompt)) {
      const isAuth = this.profile.workAuthorization?.legallyAuthorized || 'Yes';
      return {
        answer: this.matchOption(isAuth, options) || isAuth,
        confidence: 0.95,
        reasoning: `Work authorization rule -> ${isAuth}`
      };
    }

    // 4. SECURITY CLEARANCE
    if (/security clearance|clearance/i.test(cleanPrompt)) {
      const clearance = this.profile.workAuthorization?.securityClearance || 'No';
      return {
        answer: this.matchOption(clearance, options) || clearance,
        confidence: 0.95,
        reasoning: `Security clearance -> ${clearance}`
      };
    }

    // 5. COMMUTE / RELOCATION / REMOTE
    if (/commute|relocate|relocation|willing to relocate/i.test(cleanPrompt)) {
      const willing = this.profile.workAuthorization?.willingToRelocate || 'Yes';
      return {
        answer: this.matchOption(willing, options) || willing,
        confidence: 0.9,
        reasoning: `Relocation preference -> ${willing}`
      };
    }
    if (/remote|work remotely|comfortable working remotely/i.test(cleanPrompt)) {
      return {
        answer: this.matchOption('Yes', options) || 'Yes',
        confidence: 0.95,
        reasoning: 'Remote work comfort -> Yes'
      };
    }

    // 6. EDUCATION & DEGREE
    if (/bachelor|degree|education|highest level of education|completed.*degree|graduat/i.test(cleanPrompt)) {
      if (options.length > 0) {
        // Look for Bachelor's or BS in options
        const bachelorOpt = options.find(o => /bachelor|bs|undergraduate/i.test(o));
        if (bachelorOpt) {
          return { answer: bachelorOpt, confidence: 0.95, reasoning: `Found degree in options: ${bachelorOpt}` };
        }
      }
      return {
        answer: this.matchOption('Yes', options) || 'Yes',
        confidence: 0.9,
        reasoning: 'Education requirement confirmation -> Yes'
      };
    }

    // 7. NOTICE PERIOD / AVAILABILITY
    if (/notice period|how soon|when can you start|start date|availability/i.test(cleanPrompt)) {
      if (inputType === 'number' || /weeks|days/i.test(cleanPrompt)) {
        return {
          answer: this.profile.compensationAndAvailability?.noticePeriodWeeks || 2,
          confidence: 0.85,
          reasoning: 'Notice period in weeks'
        };
      }
      const notice = this.profile.compensationAndAvailability?.noticePeriod || 'Immediately';
      return {
        answer: this.matchOption(notice, options) || notice,
        confidence: 0.85,
        reasoning: `Notice period -> ${notice}`
      };
    }

    // 8. SALARY / COMPENSATION / CTC
    if (/salary|compensation|desired rate|hourly rate|pay expectation|ctc|inr|lpa/i.test(cleanPrompt)) {
      const isINR = /inr|lpa|ctc/i.test(cleanPrompt);
      const isCurrent = /current/i.test(cleanPrompt);
      const defaultINR = isCurrent ? 600000 : 900000;
      const defaultUSD = this.profile.compensationAndAvailability?.desiredSalaryNumeric || 50000;
      const salaryNum = isINR ? defaultINR : defaultUSD;

      if (options.length > 0) {
        return {
          answer: this.matchOption(String(salaryNum), options) || options[0],
          confidence: 0.9,
          reasoning: `Matched salary option -> ${salaryNum}`
        };
      }

      return {
        answer: String(salaryNum),
        confidence: 0.9,
        reasoning: `Salary/CTC expectation: ${salaryNum}`
      };
    }

    // 9. CONTACT / URLS
    if (/email/i.test(cleanPrompt)) {
      const email = this.profile.personal?.email || '';
      return { answer: this.matchOption(email, options) || email, confidence: 0.95, reasoning: 'Email address' };
    }
    if (/country code|phone code/i.test(cleanPrompt)) {
      const cc = this.profile.personal?.phoneCountryCode || 'Pakistan (+92)';
      return { answer: this.matchOption(cc, options) || cc, confidence: 0.95, reasoning: 'Phone country code' };
    }
    if (/headline/i.test(cleanPrompt)) {
      return { answer: this.profile.personal?.headline || 'AI Engineer | Generative AI & LLMs', confidence: 0.95, reasoning: 'Headline' };
    }
    if (/cover letter|why.*interested|note.*hiring|message.*recruiter/i.test(cleanPrompt)) {
      const evaluation = eligibilityEngine.evaluateEligibility(jobInfo);
      const letter = eligibilityEngine.generateTailoredCoverLetter(jobInfo, evaluation.matchedSkills);
      return {
        answer: letter,
        confidence: 0.95,
        reasoning: `Tailored cover note citing JD skills: ${evaluation.matchedSkills.slice(0, 3).join(', ') || 'AI/LLM'}`
      };
    }
    if (/time zone|timezone|pacific|eastern|pst|est/i.test(cleanPrompt)) {
      return { answer: this.matchOption('Yes', options) || 'Yes', confidence: 0.95, reasoning: 'Comfortable with client timezone' };
    }
    if (/summary/i.test(cleanPrompt)) {
      return {
        answer: "Performance-driven Computer Science graduate specializing in AI/ML and Generative AI systems. Experienced in designing RAG architectures, benchmarking LLMs, fine-tuning models, and deploying FastAPI microservices.",
        confidence: 0.9,
        reasoning: 'Professional summary'
      };
    }
    if (/github/i.test(cleanPrompt)) {
      return { answer: this.profile.personal?.links?.github || '', confidence: 0.95, reasoning: 'GitHub URL' };
    }
    if (/linkedin/i.test(cleanPrompt)) {
      return { answer: this.profile.personal?.links?.linkedin || '', confidence: 0.95, reasoning: 'LinkedIn URL' };
    }
    if (/website|portfolio|blog/i.test(cleanPrompt)) {
      return { answer: this.profile.personal?.links?.portfolio || '', confidence: 0.95, reasoning: 'Portfolio URL' };
    }
    if (/phone|mobile/i.test(cleanPrompt)) {
      return { answer: this.profile.personal?.phone || '', confidence: 0.95, reasoning: 'Phone Number' };
    }
    if (/city/i.test(cleanPrompt)) {
      return { answer: this.profile.personal?.address?.city || '', confidence: 0.9, reasoning: 'City' };
    }
    if (/postal|zip/i.test(cleanPrompt)) {
      return { answer: this.profile.personal?.address?.postalCode || '', confidence: 0.9, reasoning: 'Postal Code' };
    }

    // 10. GENERIC YES/NO
    if (options.length === 2 && options.some(o => /^yes$/i.test(o)) && options.some(o => /^no$/i.test(o))) {
      // Questions asking for experience, skills, comfort, authorization, agreement generally desire 'Yes'
      if (/have you|do you have|are you comfortable|are you at least|agree|acknowledge|proficient/i.test(cleanPrompt)) {
        return { answer: this.matchOption('Yes', options), confidence: 0.8, reasoning: 'Affirmative qualification -> Yes' };
      }
      // Negative disqualifiers
      if (/convicted|felony|terminated|fired/i.test(cleanPrompt)) {
        return { answer: this.matchOption('No', options), confidence: 0.9, reasoning: 'Disqualifier -> No' };
      }
      return { answer: this.matchOption('Yes', options), confidence: 0.6, reasoning: 'Default Yes/No -> Yes' };
    }

    const isNumericPrompt = inputType === 'number' || /how many|number of|months|years|ctc|salary|amount|rate|inr|lpa/i.test(cleanPrompt);
    return {
      answer: isNumericPrompt ? 2 : 'Yes',
      confidence: 0.4,
      reasoning: isNumericPrompt ? 'Numeric prompt fallback -> 2' : 'Generic fallback answer -> Yes'
    };
  }

  matchOption(desired, options) {
    if (!options || options.length === 0) return desired;
    const cleanDesired = String(desired).toLowerCase().trim();

    // Exact match
    const exact = options.find(o => o.toLowerCase().trim() === cleanDesired);
    if (exact) return exact;

    // Numeric match: if desired is a number e.g. "2"
    const num = parseInt(cleanDesired, 10);
    if (!isNaN(num)) {
      // 1. Look for options with exact number word boundary or simple number
      const numExact = options.find(o => new RegExp(`(^|\\D)${num}(\\D|$)`).test(o));
      if (numExact) return numExact;

      // 2. Look for range match like "1-3", "2-5", "1 to 3"
      const rangeMatch = options.find(o => {
        const m = o.match(/(\d+)\s*[-–to]\s*(\d+)/i);
        if (m) {
          const min = parseInt(m[1], 10);
          const max = parseInt(m[2], 10);
          return num >= min && num <= max;
        }
        return false;
      });
      if (rangeMatch) return rangeMatch;

      // 3. Look for "X+" or "more than X"
      const plusMatch = options.find(o => {
        const m = o.match(/(\d+)\s*\+/);
        if (m) {
          const base = parseInt(m[1], 10);
          return num >= base;
        }
        return false;
      });
      if (plusMatch) return plusMatch;
    }

    // Contains match
    const contains = options.find(o => o.toLowerCase().includes(cleanDesired) || cleanDesired.includes(o.toLowerCase()));
    if (contains) return contains;

    // Filter out placeholder like "Select an option" if choosing fallback
    const nonPlaceholder = options.find(o => !/select an option|choose|please select/i.test(o));
    return nonPlaceholder || options[0];
  }

  /**
   * Synthesize a concise, tailored pitch note for startup founders / Wellfound
   */
  generatePitchNote(jobInfo = {}) {
    const p = this.profile.personal || {};
    const name = p.firstName || p.fullName || 'Candidate';
    const company = jobInfo.company || 'your team';
    const title = jobInfo.title || 'the role';

    // Extract matched skills
    let matched = [];
    if (jobInfo.description) {
      const skills = Object.keys(this.profile.workExperienceYears || {}).filter(s => s !== 'total');
      const descLower = jobInfo.description.toLowerCase();
      matched = skills.filter(s => descLower.includes(s.toLowerCase()));
    }
    const keySkills = matched.slice(0, 3).join(', ') || 'Python, LLMs, and Multi-Agent AI systems';

    let projectMention = '';
    try {
      const cvTailor = require('./cvTailor');
      const projects = cvTailor.generateSuggestedProjects(jobInfo);
      if (projects && projects.length > 0) {
        projectMention = ` Most recently, I engineered a ${projects[0].name.toLowerCase()} leveraging ${projects[0].techStack.slice(0, 3).join(', ')}.`;
      }
    } catch (_) {}

    return `Hi ${company} team,\n\nI'm ${name}, an engineer specialized in ${keySkills}. I noticed your opening for ${title} and love what you're building.${projectMention} I've designed and deployed robust AI workflows in production and would love to bring that momentum to ${company}.\n\nLooking forward to speaking with the team!`;
  }
}

module.exports = new QuestionEngine();
