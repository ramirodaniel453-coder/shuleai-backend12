'use strict';

// Subject compatibility remains here for legacy endpoints. All grade computation,
// including legacy compatibility, is owned by services/gradingEngine.js.
const gradingEngine = require('../services/gradingEngine');

const CURRICULUMS = Object.freeze(Object.fromEntries(
  Object.entries(gradingEngine.LEGACY_PROFILES).map(([code,profile])=>{
    const bands=profile.bands||profile.fallbackBands||[];
    const rows=bands.map(row=>({range:[row.min,row.max],grade:row.label}));
    return [code,{primary:rows,secondary:rows}];
  })
));

function getSubjectsForCurriculum(curriculum, level) {
  const subjects = {
    cbc: {
      primary: ['Mathematics','English','Kiswahili','Science','Social Studies','CRE/IRE','Physical Education'],
      secondary: ['Mathematics','English','Kiswahili','Biology','Chemistry','Physics','History','Geography','CRE/IRE','Business Studies','Agriculture','Computer Studies']
    },
    '844': {
      primary: ['Mathematics','English','Kiswahili','Science','Social Studies','CRE/IRE'],
      secondary: ['Mathematics','English','Kiswahili','Biology','Chemistry','Physics','History','Geography','CRE/IRE','Business Studies','Agriculture','Computer Studies']
    },
    british: {
      primary: ['English','Mathematics','Science','History','Geography','Art','Music','PE'],
      secondary: ['English','Mathematics','Biology','Chemistry','Physics','History','Geography','French','Spanish','Computer Science','Business','Economics']
    },
    american: {
      primary: ['English Language Arts','Mathematics','Science','Social Studies','Art','Music','PE'],
      secondary: ['English','Mathematics','Biology','Chemistry','Physics','History','Government','Economics','Spanish','French','Computer Science']
    }
  };
  const curriculumKey=gradingEngine.normalizeCurriculumKey(curriculum);
  const levelKey=(level==='both'||level==='secondary')?'secondary':'primary';
  return subjects[curriculumKey]?.[levelKey]||subjects.cbc.secondary;
}

module.exports={
  getGradeFromScore:gradingEngine.getGradeFromScore,
  getSubjectsForCurriculum,
  CURRICULUMS,
  normalizeCurriculumKey:gradingEngine.normalizeCurriculumKey
};
