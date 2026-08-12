'use strict';

const CURRICULUM_ALIASES = {
  cbe: 'cbc',
  cbc: 'cbc',
  '8-4-4': '844',
  '844': '844',
  british: 'british',
  cambridge: 'british',
  american: 'american',
  custom: 'custom'
};

function normalizeCurriculum(value) {
  const key = String(value || 'cbc').trim().toLowerCase();
  return CURRICULUM_ALIASES[key] || 'cbc';
}

function titleCase(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const SUBJECT_BANK = {
  cbc: {
    label: 'CBC / CBE',
    levels: [
      { code:'playgroup', label:'Playgroup', group:'Pre-primary', order:1 },
      { code:'pp1', label:'PP1', group:'Pre-primary', order:2 },
      { code:'pp2', label:'PP2', group:'Pre-primary', order:3 },
      { code:'grade_1', label:'Grade 1', group:'Lower Primary', order:4 },
      { code:'grade_2', label:'Grade 2', group:'Lower Primary', order:5 },
      { code:'grade_3', label:'Grade 3', group:'Lower Primary', order:6 },
      { code:'grade_4', label:'Grade 4', group:'Upper Primary', order:7 },
      { code:'grade_5', label:'Grade 5', group:'Upper Primary', order:8 },
      { code:'grade_6', label:'Grade 6', group:'Upper Primary', order:9 },
      { code:'grade_7', label:'Grade 7', group:'Junior School', order:10 },
      { code:'grade_8', label:'Grade 8', group:'Junior School', order:11 },
      { code:'grade_9', label:'Grade 9', group:'Junior School', order:12 },
      { code:'grade_10', label:'Grade 10', group:'Senior School', order:13 },
      { code:'grade_11', label:'Grade 11', group:'Senior School', order:14 },
      { code:'grade_12', label:'Grade 12', group:'Senior School', order:15 }
    ],
    subjects: [
      ...['playgroup','pp1','pp2'].flatMap(levelCode => [
        ['language_activities','Language Activities','core'],
        ['mathematical_activities','Mathematical Activities','core'],
        ['environmental_activities','Environmental Activities','core'],
        ['psychomotor_creative','Psychomotor & Creative Activities','core'],
        ['religious_moral','Religious & Moral Activities','religious_choice']
      ].map(([id,name,category], i) => ({ id:`cbc_${levelCode}_${id}`, name, category, levelCodes:[levelCode], isCore:category==='core', isOptional:false, countsInFinalByDefault:false, order:i+1 }))),
      ...['grade_1','grade_2','grade_3'].flatMap(levelCode => [
        ['english_activities','English Activities','core'],
        ['kiswahili','Kiswahili','core'],
        ['mathematics','Mathematics','core'],
        ['environmental_activities','Environmental Activities','core'],
        ['creative_activities','Creative Activities','core'],
        ['cre','CRE','religious_choice'],
        ['ire','IRE','religious_choice'],
        ['hre','HRE','religious_choice'],
        ['indigenous_language','Indigenous Language','language_choice']
      ].map(([id,name,category], i) => ({ id:`cbc_${levelCode}_${id}`, name, category, levelCodes:[levelCode], isCore:category==='core', isOptional:category!=='core', countsInFinalByDefault:category==='core', order:i+1 }))),
      ...['grade_4','grade_5','grade_6'].flatMap(levelCode => [
        ['english','English','core'],
        ['kiswahili','Kiswahili','core'],
        ['mathematics','Mathematics','core'],
        ['science_technology','Science & Technology','core'],
        ['social_studies','Social Studies','core'],
        ['agriculture_nutrition','Agriculture / Nutrition','core'],
        ['creative_arts','Creative Arts','core'],
        ['cre','CRE','religious_choice'],
        ['ire','IRE','religious_choice'],
        ['hre','HRE','religious_choice'],
        ['arabic','Arabic','language_choice'],
        ['french','French','language_choice'],
        ['german','German','language_choice'],
        ['mandarin','Mandarin','language_choice'],
        ['indigenous_language','Indigenous Language','language_choice']
      ].map(([id,name,category], i) => ({ id:`cbc_${levelCode}_${id}`, name, category, levelCodes:[levelCode], isCore:category==='core', isOptional:category!=='core', countsInFinalByDefault:category==='core', order:i+1 }))),
      ...['grade_7','grade_8','grade_9'].flatMap(levelCode => [
        ['english','English','core'],
        ['kiswahili','Kiswahili / KSL','core'],
        ['mathematics','Mathematics','core'],
        ['integrated_science','Integrated Science','core'],
        ['pre_technical','Pre-Technical Studies','core'],
        ['social_studies','Social Studies','core'],
        ['agriculture','Agriculture','core'],
        ['creative_arts','Creative Arts','core'],
        ['cre','CRE','religious_choice'],
        ['ire','IRE','religious_choice'],
        ['hre','HRE','religious_choice'],
        ['arabic','Arabic','language_choice'],
        ['french','French','language_choice'],
        ['german','German','language_choice'],
        ['mandarin','Mandarin','language_choice'],
        ['indigenous_language','Indigenous Language','language_choice']
      ].map(([id,name,category], i) => ({ id:`cbc_${levelCode}_${id}`, name, category, levelCodes:[levelCode], isCore:category==='core', isOptional:category!=='core', countsInFinalByDefault:category==='core', order:i+1 }))),
      ...['grade_10','grade_11','grade_12'].flatMap(levelCode => [
        ['english','English','compulsory', null, null],
        ['kiswahili_ksl','Kiswahili / KSL','compulsory', null, null],
        ['core_mathematics','Core Mathematics','compulsory', 'STEM', null],
        ['essential_mathematics','Essential Mathematics','compulsory', 'Social Sciences / Arts', null],
        ['community_service','Community Service Learning','compulsory', null, null],
        ['biology','Biology','pathway', 'STEM', 'Pure Sciences'],
        ['chemistry','Chemistry','pathway', 'STEM', 'Pure Sciences'],
        ['physics','Physics','pathway', 'STEM', 'Pure Sciences'],
        ['general_science','General Science','pathway', 'STEM', 'Applied Sciences'],
        ['advanced_mathematics','Advanced Mathematics','pathway', 'STEM', 'Pure Sciences'],
        ['computer_studies','Computer Studies','pathway', 'STEM', 'Applied Sciences'],
        ['agriculture','Agriculture','pathway', 'STEM', 'Applied Sciences'],
        ['technical_studies','Technical Studies','pathway', 'STEM', 'Technical Studies'],
        ['business_studies','Business Studies','pathway', 'Social Sciences', 'Humanities & Business Studies'],
        ['history_citizenship','History & Citizenship','pathway', 'Social Sciences', 'Humanities & Business Studies'],
        ['geography','Geography','pathway', 'Social Sciences', 'Humanities & Business Studies'],
        ['literature_english','Literature in English','pathway', 'Social Sciences', 'Languages & Literature'],
        ['fasihi_kiswahili','Fasihi ya Kiswahili','pathway', 'Social Sciences', 'Languages & Literature'],
        ['cre','CRE','religious_choice', 'Social Sciences', 'Humanities & Business Studies'],
        ['ire','IRE','religious_choice', 'Social Sciences', 'Humanities & Business Studies'],
        ['hre','HRE','religious_choice', 'Social Sciences', 'Humanities & Business Studies'],
        ['arabic','Arabic','language_choice', 'Social Sciences', 'Languages & Literature'],
        ['french','French','language_choice', 'Social Sciences', 'Languages & Literature'],
        ['german','German','language_choice', 'Social Sciences', 'Languages & Literature'],
        ['mandarin','Mandarin','language_choice', 'Social Sciences', 'Languages & Literature'],
        ['indigenous_language','Indigenous Language','language_choice', 'Social Sciences', 'Languages & Literature'],
        ['sports_recreation','Sports and Recreation','pathway', 'Arts & Sports Science', 'Sports'],
        ['music_dance','Music and Dance','pathway', 'Arts & Sports Science', 'Arts'],
        ['theatre_film','Theatre and Film','pathway', 'Arts & Sports Science', 'Arts'],
        ['fine_arts','Fine Arts','pathway', 'Arts & Sports Science', 'Arts']
      ].map(([id,name,category,pathway,track], i) => ({ id:`cbc_${levelCode}_${id}`, name, category, pathway, track, levelCodes:[levelCode], isCore:category==='compulsory', isOptional:category!=='compulsory', countsInFinalByDefault:category!=='religious_choice', order:i+1 })))
    ]
  },
  '844': {
    label: '8-4-4',
    levels: [
      ...Array.from({ length: 8 }, (_, i) => ({ code:`class_${i+1}`, label:`Class ${i+1}`, group:'Primary', order:i+1 })),
      ...Array.from({ length: 4 }, (_, i) => ({ code:`form_${i+1}`, label:`Form ${i+1}`, group:'Secondary', order:i+9 }))
    ],
    subjects: []
  },
  british: {
    label: 'British / Cambridge',
    levels: [
      { code:'nursery', label:'Nursery', group:'Early Years', order:1 },
      { code:'reception', label:'Reception', group:'Early Years', order:2 },
      ...Array.from({ length: 13 }, (_, i) => ({ code:`year_${i+1}`, label:`Year ${i+1}`, group:i<6?'Primary':i<9?'Lower Secondary':i<11?'IGCSE':'A Level', order:i+3 }))
    ],
    subjects: []
  },
  american: {
    label: 'American',
    levels: [
      { code:'pre_k', label:'Pre-K', group:'Early Years', order:1 },
      { code:'kindergarten', label:'Kindergarten', group:'Early Years', order:2 },
      ...Array.from({ length: 12 }, (_, i) => ({ code:`grade_${i+1}`, label:`Grade ${i+1}`, group:i<5?'Elementary':i<8?'Middle School':'High School', order:i+3 }))
    ],
    subjects: []
  },
  custom: { label: 'Custom', levels: [], subjects: [] }
};

SUBJECT_BANK['844'].subjects = [
  ...Array.from({ length: 8 }, (_, i) => `class_${i+1}`).flatMap(levelCode => [
    ['english','English','core'], ['kiswahili','Kiswahili','core'], ['mathematics','Mathematics','core'], ['science','Science','core'], ['social_studies_re','Social Studies & Religious Education','core'], ['creative_arts','Creative Arts','optional'], ['physical_education','Physical Education','optional'], ['life_skills','Life Skills','optional']
  ].map(([id,name,category], order) => ({ id:`844_${levelCode}_${id}`, name, category, levelCodes:[levelCode], isCore:category==='core', isOptional:category!=='core', countsInFinalByDefault:category==='core', order:order+1 }))),
  ...Array.from({ length: 4 }, (_, i) => `form_${i+1}`).flatMap(levelCode => [
    ['english','English','core'], ['kiswahili','Kiswahili','core'], ['mathematics','Mathematics','core'], ['biology','Biology','science'], ['chemistry','Chemistry','science'], ['physics','Physics','science'], ['history','History','humanities'], ['geography','Geography','humanities'], ['cre','CRE','religious_choice'], ['ire','IRE','religious_choice'], ['hre','HRE','religious_choice'], ['business_studies','Business Studies','applied'], ['agriculture','Agriculture','applied'], ['home_science','Home Science','applied'], ['computer_studies','Computer Studies','applied'], ['french','French','language_choice'], ['german','German','language_choice'], ['arabic','Arabic','language_choice'], ['music','Music','creative'], ['art_design','Art and Design','creative'], ['technical_subjects','Technical Subjects','technical']
  ].map(([id,name,category], order) => ({ id:`844_${levelCode}_${id}`, name, category, levelCodes:[levelCode], isCore:['english','kiswahili','mathematics'].includes(id), isOptional:!['english','kiswahili','mathematics'].includes(id), countsInFinalByDefault:true, order:order+1 })))
];

SUBJECT_BANK.british.subjects = SUBJECT_BANK.british.levels.flatMap(level => {
  const common = level.group === 'A Level'
    ? [['english_language','English Language','core'], ['mathematics','Mathematics','core'], ['biology','Biology','science'], ['chemistry','Chemistry','science'], ['physics','Physics','science'], ['computer_science','Computer Science','ict'], ['business_studies','Business Studies','business'], ['economics','Economics','business'], ['history','History','humanities'], ['geography','Geography','humanities'], ['french','French','language'], ['art','Art','creative'], ['music','Music','creative']]
    : [['english','English','core'], ['mathematics','Mathematics','core'], ['science','Science','core'], ['ict_computer_science','ICT / Computer Science','ict'], ['history','History','humanities'], ['geography','Geography','humanities'], ['business_studies','Business Studies','business'], ['french','French','language'], ['art','Art','creative'], ['music','Music','creative'], ['physical_education','Physical Education','pe'], ['religious_studies','Religious Studies','humanities']];
  return common.map(([id,name,category], order) => ({ id:`british_${level.code}_${id}`, name, category, levelCodes:[level.code], isCore:category==='core', isOptional:category!=='core', countsInFinalByDefault:true, order:order+1 }));
});

SUBJECT_BANK.american.subjects = SUBJECT_BANK.american.levels.flatMap(level => [
  ['english_language_arts','English Language Arts','core'], ['mathematics','Mathematics','core'], ['science','Science','core'], ['social_studies','Social Studies','core'], ['physical_education','Physical Education','pe'], ['arts','Arts','creative'], ['world_languages','World Languages','language'], ['technology','Technology','technology'], ['electives','Electives','elective']
].map(([id,name,category], order) => ({ id:`american_${level.code}_${id}`, name, category, levelCodes:[level.code], isCore:category==='core', isOptional:category!=='core', countsInFinalByDefault:category!=='pe', order:order+1 })));

const STRUCTURE_PRESETS = {
  cbc: {
    primary_only: ['playgroup','pp1','pp2','grade_1','grade_2','grade_3','grade_4','grade_5','grade_6'],
    junior_only: ['grade_7','grade_8','grade_9'],
    senior_only: ['grade_10','grade_11','grade_12'],
    secondary_only: ['grade_7','grade_8','grade_9','grade_10','grade_11','grade_12'],
    mixed: ['playgroup','pp1','pp2','grade_1','grade_2','grade_3','grade_4','grade_5','grade_6','grade_7','grade_8','grade_9','grade_10','grade_11','grade_12'],
    full_school: ['playgroup','pp1','pp2','grade_1','grade_2','grade_3','grade_4','grade_5','grade_6','grade_7','grade_8','grade_9','grade_10','grade_11','grade_12']
  },
  '844': {
    primary_only: Array.from({ length: 8 }, (_, i) => `class_${i+1}`),
    secondary_only: Array.from({ length: 4 }, (_, i) => `form_${i+1}`),
    mixed: [...Array.from({ length: 8 }, (_, i) => `class_${i+1}`), ...Array.from({ length: 4 }, (_, i) => `form_${i+1}`)],
    full_school: [...Array.from({ length: 8 }, (_, i) => `class_${i+1}`), ...Array.from({ length: 4 }, (_, i) => `form_${i+1}`)]
  },
  british: {
    primary_only: ['nursery','reception','year_1','year_2','year_3','year_4','year_5','year_6'],
    secondary_only: ['year_7','year_8','year_9','year_10','year_11','year_12','year_13'],
    mixed: ['nursery','reception', ...Array.from({ length: 13 }, (_, i) => `year_${i+1}`)],
    full_school: ['nursery','reception', ...Array.from({ length: 13 }, (_, i) => `year_${i+1}`)]
  },
  american: {
    primary_only: ['pre_k','kindergarten','grade_1','grade_2','grade_3','grade_4','grade_5'],
    secondary_only: ['grade_6','grade_7','grade_8','grade_9','grade_10','grade_11','grade_12'],
    mixed: ['pre_k','kindergarten', ...Array.from({ length: 12 }, (_, i) => `grade_${i+1}`)],
    full_school: ['pre_k','kindergarten', ...Array.from({ length: 12 }, (_, i) => `grade_${i+1}`)]
  }
};

function getBank(curriculum) {
  return SUBJECT_BANK[normalizeCurriculum(curriculum)] || SUBJECT_BANK.cbc;
}

function getLevelByCode(curriculum, code) {
  return getBank(curriculum).levels.find(l => String(l.code) === String(code));
}

function levelCodeFromGrade(curriculum, gradeOrName) {
  const bank = getBank(curriculum);
  const raw = String(gradeOrName || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (!raw) return null;
  const exact = bank.levels.find(l => l.code === raw || l.label.toLowerCase().replace(/[-\s]+/g, '_') === raw);
  if (exact) return exact.code;
  const gradeMatch = raw.match(/grade_?(\d+)/); if (gradeMatch) return `grade_${gradeMatch[1]}`;
  const classMatch = raw.match(/class_?(\d+)/); if (classMatch) return `class_${classMatch[1]}`;
  const formMatch = raw.match(/form_?(\d+)/); if (formMatch) return `form_${formMatch[1]}`;
  const yearMatch = raw.match(/year_?(\d+)/); if (yearMatch) return `year_${yearMatch[1]}`;
  if (raw.includes('pp1')) return 'pp1';
  if (raw.includes('pp2')) return 'pp2';
  if (raw.includes('play')) return 'playgroup';
  if (raw.includes('nursery')) return 'nursery';
  if (raw.includes('reception')) return 'reception';
  if (raw.includes('kindergarten')) return 'kindergarten';
  if (raw === 'pre_k' || raw === 'prek') return 'pre_k';
  return null;
}


const LEVEL_GROUPS = {
  cbc: [
    { code:'early_learning', label:'Early Learning', description:'PP1–PP2', levelCodes:['pp1','pp2'] },
    { code:'primary_learning', label:'Primary Learning', description:'Grade 1–6', levelCodes:['grade_1','grade_2','grade_3','grade_4','grade_5','grade_6'] },
    { code:'junior_school', label:'Junior School', description:'Grade 7–9', levelCodes:['grade_7','grade_8','grade_9'] },
    { code:'senior_secondary', label:'Senior Secondary', description:'Grade 10–12', levelCodes:['grade_10','grade_11','grade_12'] }
  ],
  '844': [
    { code:'primary_844', label:'8-4-4 Primary', description:'Class 1–8', levelCodes:['class_1','class_2','class_3','class_4','class_5','class_6','class_7','class_8'] },
    { code:'secondary_844', label:'8-4-4 Secondary', description:'Form 1–4', levelCodes:['form_1','form_2','form_3','form_4'] }
  ],
  british: [
    { code:'british_early_primary', label:'Early & Primary', description:'Nursery, Reception, Year 1–6', levelCodes:['nursery','reception','year_1','year_2','year_3','year_4','year_5','year_6'] },
    { code:'british_secondary', label:'Secondary', description:'Year 7–13', levelCodes:['year_7','year_8','year_9','year_10','year_11','year_12','year_13'] }
  ],
  american: [
    { code:'american_elementary', label:'Elementary', description:'Pre-K to Grade 5', levelCodes:['pre_k','kindergarten','grade_1','grade_2','grade_3','grade_4','grade_5'] },
    { code:'american_middle', label:'Middle School', description:'Grade 6–8', levelCodes:['grade_6','grade_7','grade_8'] },
    { code:'american_high', label:'High School', description:'Grade 9–12', levelCodes:['grade_9','grade_10','grade_11','grade_12'] }
  ],
  custom: []
};

const DEFAULT_ASSESSMENT_SETTINGS = [
  { key:'cat1', label:'CAT 1', showOnReport:true, countInFinal:true, weight:10, displayOrder:1, assessmentType:'CAT 1' },
  { key:'cat2', label:'CAT 2', showOnReport:true, countInFinal:true, weight:10, displayOrder:2, assessmentType:'CAT 2' },
  { key:'midterm', label:'Midterm', showOnReport:true, countInFinal:true, weight:20, displayOrder:3, assessmentType:'Midterm' },
  { key:'endterm', label:'End Term', showOnReport:true, countInFinal:true, weight:40, displayOrder:4, assessmentType:'End Term' },
  { key:'sba', label:'SBA', showOnReport:false, countInFinal:false, weight:20, displayOrder:5, assessmentType:'SBA' },
  { key:'project', label:'Project', showOnReport:false, countInFinal:false, weight:0, displayOrder:6, assessmentType:'Project' },
  { key:'practical', label:'Practical', showOnReport:false, countInFinal:false, weight:0, displayOrder:7, assessmentType:'Practical' }
];

function getLevelGroups(curriculum='cbc') {
  return LEVEL_GROUPS[normalizeCurriculum(curriculum)] || LEVEL_GROUPS.custom || [];
}
function expandEnabledLevelCodes(curriculum='cbc', values=[]) {
  const cur = normalizeCurriculum(curriculum);
  const groups = new Map(getLevelGroups(cur).map(g => [g.code, g]));
  const allLevels = new Set((SUBJECT_BANK[cur]?.levels || []).map(l => l.code));
  const expanded = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw || '').trim();
    if (!value) continue;
    if (groups.has(value)) expanded.push(...groups.get(value).levelCodes);
    else if (allLevels.has(value)) expanded.push(value);
  }
  return [...new Set(expanded)];
}
function groupsFromEnabledLevels(curriculum='cbc', values=[]) {
  const enabled = new Set(expandEnabledLevelCodes(curriculum, values));
  return getLevelGroups(curriculum).filter(g => g.levelCodes.every(c => enabled.has(c))).map(g => g.code);
}
function defaultAssessmentSettings() { return DEFAULT_ASSESSMENT_SETTINGS.map(x => ({...x})); }

function getCurriculumConfig(school) {
  const settings = school?.settings || {};
  const engine = settings.curriculumEngine || {};
  const curriculum = normalizeCurriculum(engine.curriculum || settings.curriculum || school?.system || 'cbc');
  const structureType = engine.structureType || settings.schoolStructure || school?.schoolStructure || 'mixed';
  const preset = structureType === 'custom'
    ? []
    : (STRUCTURE_PRESETS[curriculum]?.[structureType] || STRUCTURE_PRESETS[curriculum]?.mixed || (SUBJECT_BANK[curriculum]?.levels || []).map(l => l.code));
  const explicitLevels = Array.isArray(engine.enabledLevels) && engine.enabledLevels.length ? engine.enabledLevels : (Array.isArray(school?.enabledLevels) ? school.enabledLevels : []);
  const explicitGroups = Array.isArray(engine.enabledLevelGroups) && engine.enabledLevelGroups.length ? engine.enabledLevelGroups : [];
  // If an admin selected grouped levels (Early/Primary/Junior/Senior), honor those groups first.
  // Only use the structure preset when neither grouped levels nor individual levels were saved.
  // This prevents primary/junior-only schools from accidentally generating the whole mixed list.
  const rawLevels = explicitLevels.length ? explicitLevels : (explicitGroups.length ? explicitGroups : preset);
  const enabledLevels = expandEnabledLevelCodes(curriculum, rawLevels);
  const groups = groupsFromEnabledLevels(curriculum, rawLevels);
  const schoolSubjects = Array.isArray(engine.schoolSubjects) ? engine.schoolSubjects : [];
  const assessmentSettings = Array.isArray(engine.assessmentSettings) && engine.assessmentSettings.length ? engine.assessmentSettings : defaultAssessmentSettings();
  return { curriculum, structureType, enabledLevels, enabledLevelGroups:groups, levelGroups:getLevelGroups(curriculum), schoolSubjects, assessmentSettings, engine };
}

function getAllowedLevelsForSchool(school) {
  const cfg = getCurriculumConfig(school);
  const bank = getBank(cfg.curriculum);
  const enabled = new Set(cfg.enabledLevels);
  return bank.levels.filter(l => enabled.has(l.code)).sort((a,b) => (a.order||0)-(b.order||0));
}

function getSubjectBankForSchool(school) {
  const cfg = getCurriculumConfig(school);
  const enabled = new Set(cfg.enabledLevels);
  return getBank(cfg.curriculum).subjects
    .filter(s => (s.levelCodes || []).some(l => enabled.has(l)))
    .map(s => ({ ...s, curriculum: cfg.curriculum, levelLabels: (s.levelCodes || []).map(c => getLevelByCode(cfg.curriculum, c)?.label || titleCase(c)) }))
    .sort((a,b) => (a.levelCodes?.[0] || '').localeCompare(b.levelCodes?.[0] || '') || (a.order||0)-(b.order||0) || a.name.localeCompare(b.name));
}

function schoolOffersSubject(school, subject) {
  const cfg = getCurriculumConfig(school);
  // Strict V103 rule: the Add Subject curriculum checklist is the source of truth.
  // If no school subjects have been saved, no subject is considered live yet.
  // This prevents old/manual subjects from silently overriding the new engine.
  if (!cfg.schoolSubjects.length) return false;
  return cfg.schoolSubjects.some(row => (row.isOffered !== false) && (row.subjectId === subject.id || String(row.name || '').toLowerCase() === String(subject.name || '').toLowerCase()));
}

function normalizeSchoolSubject(row, cfg, levelCode, classItem) {
  if (!row || row.isOffered === false) return null;
  const levels = Array.isArray(row.levelCodes) ? row.levelCodes.map(String) : [];
  const classIds = Array.isArray(row.classIds) ? row.classIds.map(Number).filter(Boolean) : [];
  const classItemId = Number(classItem?.id || 0) || null;
  if (classIds.length && (!classItemId || !classIds.includes(classItemId))) return null;
  if (levelCode && levels.length && !levels.includes(String(levelCode))) return null;
  // Empty levelCodes means custom subject applies to the whole school or selected class(es).
  // This is intentional so admins can add non-curriculum subjects without rebuilding the curriculum bank.
  return {
    id: row.subjectId || row.id || `school_${String(row.name || row.subjectName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    name: row.name || row.subjectName || row.subject || 'Unnamed Subject',
    category: row.category || (row.isCustom ? 'custom' : 'school_subject'),
    levelCodes: levels,
    classIds,
    scope: row.scope || (classIds.length ? 'class' : 'school'),
    levelCode,
    levelLabel: getLevelByCode(cfg.curriculum, levelCode)?.label || classItem?.grade || classItem?.name || null,
    curriculum: cfg.curriculum,
    pathway: row.pathway || null,
    track: row.track || null,
    isCore: !!row.isCore,
    isOptional: row.isOptional !== undefined ? !!row.isOptional : !row.isCore,
    isCustom: !!row.isCustom || row.category === 'custom',
    countsInFinalByDefault: row.countsInFinalByDefault !== false,
    order: row.order || 999,
    source: row.isCustom ? 'custom_school_subject' : 'school_subjects'
  };
}

function getEligibleSubjectsForClass(school, classItem) {
  const cfg = getCurriculumConfig(school);
  const levelCode = classItem?.levelCode || classItem?.curriculumLevel || classItem?.settings?.curriculumMeta?.levelCode || levelCodeFromGrade(cfg.curriculum, classItem?.grade || classItem?.name || classItem?.className);
  const enabled = new Set(cfg.enabledLevels);
  if (!levelCode || !enabled.has(levelCode)) return [];
  if (!cfg.schoolSubjects.length) return [];

  const bankSubjects = getBank(cfg.curriculum).subjects
    .filter(s => (s.levelCodes || []).includes(levelCode))
    .filter(s => schoolOffersSubject(school, s))
    .map(s => ({ ...s, curriculum: cfg.curriculum, levelCode, levelLabel: getLevelByCode(cfg.curriculum, levelCode)?.label || classItem?.grade || classItem?.name, source: 'curriculum_bank' }));

  const bankNames = new Set(bankSubjects.map(s => String(s.name || '').toLowerCase()));
  const customSchoolSubjects = cfg.schoolSubjects
    .map(row => normalizeSchoolSubject(row, cfg, levelCode, classItem))
    .filter(Boolean)
    .filter(s => !bankNames.has(String(s.name || '').toLowerCase()));

  return [...bankSubjects, ...customSchoolSubjects]
    .sort((a,b) => (a.order||0)-(b.order||0) || a.name.localeCompare(b.name));
}

function validateClassLevel(school, gradeOrName) {
  const cfg = getCurriculumConfig(school);
  const levelCode = (gradeOrName && typeof gradeOrName === 'object') ? (gradeOrName.levelCode || gradeOrName.curriculumLevel || gradeOrName.settings?.curriculumMeta?.levelCode || levelCodeFromGrade(cfg.curriculum, gradeOrName.grade || gradeOrName.name || gradeOrName.className)) : levelCodeFromGrade(cfg.curriculum, gradeOrName);
  if (!levelCode) return { ok: false, levelCode: null, message: `${gradeOrName || 'This class'} does not match any enabled level in the selected ${getBank(cfg.curriculum).label} curriculum. Select a valid level from the school structure.` };
  const ok = cfg.enabledLevels.includes(levelCode);
  return { ok, levelCode, level: getLevelByCode(cfg.curriculum, levelCode), message: ok ? null : `${gradeOrName} is not enabled in this school's ${getBank(cfg.curriculum).label} structure.` };
}

function buildSubjectRowsForReport({ school, classItem, student, records = [], studentSubjectSelections = [] }) {
  const eligible = getEligibleSubjectsForClass(school, classItem);
  const bySubject = new Map();
  for (const r of records || []) {
    const key = String(r.subject || '').trim().toLowerCase();
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(r);
  }
  const selectionByName = new Map((studentSubjectSelections || []).map(s => [String(s.subjectName || s.subject || '').toLowerCase(), s]));
  const rows = eligible.map(subject => {
    const selected = selectionByName.get(String(subject.name).toLowerCase());
    const statusFromSelection = selected?.status || (subject.isCore ? 'taking' : 'not_taken');
    const recs = bySubject.get(String(subject.name).toLowerCase()) || [];
    const validScores = recs.map(r => Number(r.score)).filter(Number.isFinite);
    const hasScore = validScores.length > 0;
    const average = hasScore ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length) : null;
    let status = 'Pending';
    if (statusFromSelection === 'not_taken') status = 'Not Taken';
    else if (statusFromSelection === 'exempted') status = 'Exempted';
    else if (statusFromSelection === 'not_offered') status = 'Not Offered';
    else if (hasScore) status = 'Completed';
    const counted = status === 'Completed' && statusFromSelection !== 'not_taken' && statusFromSelection !== 'exempted' && statusFromSelection !== 'not_offered' && subject.countsInFinalByDefault !== false;
    return { subject: subject.name, subjectId: subject.id, category: subject.category, score: average, grade: null, status, counted, isCore: !!subject.isCore, pathway: subject.pathway || null, track: subject.track || null, assessments: recs };
  });
  return rows;
}

function summarizeReportRows(rows = []) {
  const counted = rows.filter(r => r.counted && r.score !== null && r.score !== undefined && Number.isFinite(Number(r.score)));
  const totalMarks = counted.reduce((sum, r) => sum + Number(r.score), 0);
  const average = counted.length ? Math.round(totalMarks / counted.length) : null;
  return { totalMarks, average, countedSubjects: counted.length, pendingSubjects: rows.filter(r => r.status === 'Pending').length, notTakenSubjects: rows.filter(r => r.status === 'Not Taken').length };
}

function getGradingProfile(curriculum, levelCode) {
  const cur = normalizeCurriculum(curriculum);
  if (cur === 'cbc') {
    if (['playgroup','pp1','pp2'].includes(levelCode)) return { mode:'competency_observation', ranking:false, labels:['EE','ME','AE','BE'] };
    if (['grade_10','grade_11','grade_12'].includes(levelCode)) return { mode:'pathway_marks', ranking:true, labels:['A','B','C','D','E'], seniorSelection:true };
    return { mode:'competency_marks', ranking:true, labels:['EE','ME','AE','BE'] };
  }
  if (cur === '844') return { mode:'marks_points', ranking:true, labels:['A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E'] };
  if (cur === 'british') return { mode:'igcse_alevel', ranking:false, labels:['A*','A','B','C','D','E','U'] };
  if (cur === 'american') return { mode:'gpa_credits', ranking:false, labels:['A','B','C','D','F'], gpa:true };
  return { mode:'custom', ranking:false, labels:[] };
}

module.exports = {
  LEVEL_GROUPS, DEFAULT_ASSESSMENT_SETTINGS, getLevelGroups, expandEnabledLevelCodes, groupsFromEnabledLevels, defaultAssessmentSettings,
  normalizeCurriculum,
  getBank,
  getCurriculumConfig,
  getAllowedLevelsForSchool,
  getSubjectBankForSchool,
  getEligibleSubjectsForClass,
  validateClassLevel,
  levelCodeFromGrade,
  getLevelByCode,
  buildSubjectRowsForReport,
  summarizeReportRows,
  getGradingProfile,
  STRUCTURE_PRESETS,
  SUBJECT_BANK
};
