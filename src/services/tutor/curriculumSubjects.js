const LEVELS = [
  { id: 'early_years', name: 'Early Years', grades: ['PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3'], subjects: ['Literacy', 'Kiswahili Language Activities', 'English Language Activities', 'Mathematical Activities', 'Environmental Activities', 'Creative Activities', 'Religious Education', 'Psychomotor Activities'] },
  { id: 'upper_primary', name: 'Upper Primary', grades: ['Grade 4', 'Grade 5', 'Grade 6'], subjects: ['Mathematics', 'English', 'Kiswahili', 'Science and Technology', 'Agriculture and Nutrition', 'Social Studies', 'Creative Arts', 'Religious Education', 'Physical and Health Education'] },
  { id: 'junior_secondary', name: 'Junior Secondary', grades: ['Grade 7', 'Grade 8', 'Grade 9'], subjects: ['Mathematics', 'English', 'Kiswahili', 'Integrated Science', 'Health Education', 'Pre-Technical Studies', 'Social Studies', 'Religious Education', 'Business Studies', 'Agriculture', 'Life Skills Education', 'Sports and Physical Education', 'Computer Science', 'Visual Arts', 'Performing Arts', 'Home Science', 'Foreign Languages'] },
  { id: 'senior_school', name: 'Senior School', grades: ['Grade 10', 'Grade 11', 'Grade 12', 'Form 1', 'Form 2', 'Form 3', 'Form 4'], subjects: ['Mathematics', 'English', 'Kiswahili', 'Biology', 'Chemistry', 'Physics', 'History and Government', 'Geography', 'CRE', 'IRE', 'HRE', 'Business Studies', 'Agriculture', 'Computer Studies', 'Home Science', 'Art and Design', 'Music', 'Physical Education'] }
];

const SUBJECT_ALIASES = {
  math: 'Mathematics', maths: 'Mathematics', mathematics: 'Mathematics', english: 'English', kiswahili: 'Kiswahili', swahili: 'Kiswahili', science: 'Integrated Science', biology: 'Biology', chemistry: 'Chemistry', physics: 'Physics', agriculture: 'Agriculture', business: 'Business Studies', computer: 'Computer Studies', coding: 'Computer Science', history: 'History and Government', geography: 'Geography', social: 'Social Studies', religion: 'Religious Education', cre: 'CRE', ire: 'IRE', art: 'Creative Arts', music: 'Music', home: 'Home Science', health: 'Health Education', literacy: 'Literacy'
};

function normalizeGrade(grade = '') {
  const g = String(grade || '').trim();
  if (/^pp\s?1$/i.test(g)) return 'PP1';
  if (/^pp\s?2$/i.test(g)) return 'PP2';
  const m = g.match(/(?:grade|form|class)?\s*(\d+)/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 12) return `Grade ${n}`;
  }
  return g || 'Grade 5';
}

function getLevelByGrade(grade) {
  const normalized = normalizeGrade(grade);
  return LEVELS.find(l => l.grades.includes(normalized)) || LEVELS[1];
}

function detectSubject(text = '', grade = '') {
  const lower = String(text).toLowerCase();
  for (const [key, subject] of Object.entries(SUBJECT_ALIASES)) {
    if (lower.includes(key)) return subject;
  }
  const level = getLevelByGrade(grade);
  return level.subjects[0] || 'Mathematics';
}

module.exports = { LEVELS, SUBJECT_ALIASES, normalizeGrade, getLevelByGrade, detectSubject };
