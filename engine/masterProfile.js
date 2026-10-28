/**
 * Master Profile of Shoaib Akhtar
 * Reads directly from data/profile.json (Single Source of Truth)
 * Strictly filters verified skills to guarantee honest, defensible CV generation.
 */

const profileData = require('../data/profile.json');

function getVerifiedSkillNames(categoryList) {
  if (!Array.isArray(categoryList)) return [];
  return categoryList
    .filter(skill => skill && skill.status === 'verified')
    .map(skill => skill.name);
}

const masterProfile = {
  personal: profileData.personal,
  summary: profileData.summary,
  skills: {
    languages: getVerifiedSkillNames(profileData.skills.languages),
    frameworks: getVerifiedSkillNames(profileData.skills.frameworks),
    generativeAI: getVerifiedSkillNames(profileData.skills.generativeAI),
    mlopsAndCloud: getVerifiedSkillNames(profileData.skills.mlopsAndCloud),
    dataScience: getVerifiedSkillNames(profileData.skills.dataScience)
  },
  experience: profileData.experience,
  projects: profileData.projects,
  education: profileData.education,
  certifications: profileData.certifications,

  // Metadata accessors for JD gap analysis, matching & auditing
  raw: profileData,

  getAllVerifiedSkills() {
    return [
      ...this.skills.languages,
      ...this.skills.generativeAI,
      ...this.skills.frameworks,
      ...this.skills.mlopsAndCloud,
      ...this.skills.dataScience
    ];
  },

  getAllFamiliarSkills() {
    const familiar = [];
    for (const cat of Object.keys(profileData.skills)) {
      for (const skill of profileData.skills[cat]) {
        if (skill.status === 'familiar') familiar.push(skill);
      }
    }
    return familiar;
  }
};

module.exports = masterProfile;
