const COMMANDS = [
  { command: 'quiz', keys: ['quiz me', 'test me', 'ask me', 'practice questions', 'give me questions', 'mcq'] },
  { command: 'explain', keys: ['explain', 'teach me', 'help me understand', 'what is', 'define', 'meaning'] },
  { command: 'solve', keys: ['solve', 'calculate', 'work out', 'answer this', 'find the answer'] },
  { command: 'summarize', keys: ['summarize', 'summary', 'short notes', 'notes on', 'key points'] },
  { command: 'revise', keys: ['revise', 'revision', 'prepare for exam', 'exam prep', 'kcse', 'kcpe', 'assessment'] },
  { command: 'homework', keys: ['homework', 'assignment', 'take away task', 'give homework'] },
  { command: 'weakness', keys: ['weak areas', 'weakness', 'what am i bad at', 'progress', 'performance'] },
  { command: 'plan', keys: ['study plan', 'timetable', 'schedule', 'plan my revision'] }
];
function detectCommand(text = '') {
  const lower = String(text).toLowerCase();
  const found = COMMANDS.find(c => c.keys.some(k => lower.includes(k)));
  return found ? found.command : 'ask';
}
module.exports = { detectCommand, COMMANDS };
