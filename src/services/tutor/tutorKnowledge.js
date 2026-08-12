const TOPIC_KEYWORDS = [
  { topic: 'Multiplication', keys: ['multiply', 'multiplication', 'times', ' x ', '×'] },
  { topic: 'Fractions', keys: ['fraction', 'numerator', 'denominator', 'half', 'quarter'] },
  { topic: 'Algebra', keys: ['algebra', 'equation', 'solve for x', 'variable'] },
  { topic: 'Geometry', keys: ['angle', 'triangle', 'circle', 'area', 'perimeter', 'volume'] },
  { topic: 'Grammar', keys: ['noun', 'verb', 'adjective', 'sentence', 'grammar'] },
  { topic: 'Reading Comprehension', keys: ['comprehension', 'passage', 'read'] },
  { topic: 'Matter', keys: ['matter', 'solid', 'liquid', 'gas'] },
  { topic: 'Forces', keys: ['force', 'motion', 'gravity', 'friction'] },
  { topic: 'Cells', keys: ['cell', 'organism', 'biology'] },
  { topic: 'General', keys: [] }
];
function detectTopic(text = '', subject = '') {
  const lower = String(text).toLowerCase();
  const match = TOPIC_KEYWORDS.find(t => t.keys.some(k => lower.includes(k)));
  if (match) return match.topic;
  if (/math/i.test(subject)) return 'General Mathematics';
  if (/english|kiswahili|literacy/i.test(subject)) return 'Language Skills';
  if (/science|biology|chemistry|physics/i.test(subject)) return 'Science Concepts';
  return 'General';
}
function buildTutorAnswer({ question, command, subject, topic, grade, level }) {
  const q = String(question || '').trim();
  const base = { topic, difficulty: level?.id === 'senior_school' ? 'exam' : 'medium', source: 'guided_curriculum_engine' };
  if (command === 'quiz') return { ...base, answer: `Great — quiz mode for ${subject}.`, explanation: `Question 1: In ${topic}, explain one important idea in your own words.`, nextQuestion: `Answer this: What is the main rule or concept you remember about ${topic}?` };
  if (command === 'summarize') return { ...base, answer: `${topic} summary for ${grade}`, explanation: `1. Understand the meaning.\n2. Know the key rule.\n3. Practice one example.\n4. Explain it back in your own words.`, nextQuestion: `Do you want short notes or practice questions on ${topic}?` };
  if (command === 'revise') return { ...base, answer: `Revision mode started for ${subject}.`, explanation: `We will revise ${topic} using: quick notes, example, practice question, and correction. Start by telling me the part that confuses you most.`, nextQuestion: `Should I start with notes, examples, or questions?` };
  if (command === 'homework') return { ...base, answer: `Homework task for ${subject}`, explanation: `Write 5 key points about ${topic}, then answer 3 practice questions. Submit your answer to your teacher or parent for review.`, nextQuestion: `Would you like me to generate the 3 questions now?` };
  if (command === 'weakness') return { ...base, answer: `I can track your weak areas as you practice.`, explanation: `Right now, I will use your tutor history to identify topics with many attempts or repeated questions. Continue asking and answering questions so I can build a clearer report.`, nextQuestion: `Which subject should I check first?` };
  if (command === 'plan') return { ...base, answer: `Study plan for ${subject}`, explanation: `Use 25 minutes study + 5 minutes break. Start with ${topic}, do examples, then practice. End by writing what you learned.`, nextQuestion: `How many days should the plan cover?` };
  if (command === 'solve') return { ...base, answer: `Let's solve it step by step.`, explanation: `Question: ${q}\nStep 1: Identify the topic: ${topic}.\nStep 2: Write what is given.\nStep 3: Apply the rule or formula.\nStep 4: Check your answer.`, nextQuestion: `What is your first step?` };
  return { ...base, answer: `I can help with ${subject}.`, explanation: `${q ? `Your question is: “${q}”.\n` : ''}This looks like ${topic}. I’ll explain it in a simple way, then give you one practice question.`, nextQuestion: `Tell me what you already know about ${topic}, or type “quiz me”.` };
}
module.exports = { detectTopic, buildTutorAnswer };
