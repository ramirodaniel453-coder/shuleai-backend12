const { sequelize, HomeTask, Competency, LearningOutcome } = require('../models');

const templates = [
  {
    title: '{subject} Practice',
    instructions: 'Solve {number} {subject} problems involving {topic}. Show your working.',
    type: 'Practice',
    difficulty: 'Easy',
    estimatedMinutes: 15,
    points: 10,
    materials: 'Paper, pencil'
  },
  {
    title: '{subject} Application',
    instructions: 'Apply your knowledge of {topic} to solve this real-world problem: {scenario}',
    type: 'Application',
    difficulty: 'Medium',
    estimatedMinutes: 20,
    points: 15,
    materials: 'Worksheet'
  },
  {
    title: '{subject} Reflection',
    instructions: 'Write 3-5 sentences about what you learned about {topic}. What was easy? What was challenging?',
    type: 'Reflection',
    difficulty: 'Easy',
    estimatedMinutes: 10,
    points: 5,
    materials: 'Notebook'
  }
];

const gradeLevels = [
  'PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
  'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'
];

const scenarios = [
  'You are shopping and need to calculate change.',
  'You are measuring ingredients for a recipe.',
  'You are planning a trip and need to calculate distance and time.'
];

async function generate() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    const competencies = await Competency.findAll({
      include: [{ model: LearningOutcome }]
    });

    if (competencies.length === 0) {
      console.log('⚠️ No competencies found. Please seed competencies first.');
      process.exit(0);
    }

    let created = 0;
    for (const comp of competencies) {
      for (const grade of gradeLevels) {
        for (const template of templates) {
          for (let i = 0; i < 3; i++) {
            const number = Math.floor(Math.random() * 10) + 5;
            const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
            const topic = comp.LearningOutcomes?.[0]?.description || comp.name;

            const title = template.title
              .replace('{subject}', comp.name)
              .replace('{topic}', topic);

            let instructions = template.instructions
              .replace('{number}', number)
              .replace('{subject}', comp.name)
              .replace('{topic}', topic)
              .replace('{scenario}', scenario);

            try {
              await HomeTask.create({
                title,
                instructions,
                type: template.type,
                subject: comp.category === 'core' ? 'Mathematics' : 'General',
                competencyId: comp.id,
                gradeLevel: grade,
                difficulty: template.difficulty,
                estimatedMinutes: template.estimatedMinutes,
                points: template.points,
                materials: template.materials,
                isActive: true
              });
              created++;
            } catch (err) {
              console.error(`Failed to create task: ${err.message}`);
            }
          }
        }
      }
    }

    console.log(`✅ Created ${created} home tasks`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Generation failed:', error);
    process.exit(1);
  }
}

generate();
