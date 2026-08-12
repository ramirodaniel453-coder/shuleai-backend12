// src/controllers/helpController.js
const { Op } = require('sequelize');
const { User } = require('../models');

// Help articles database
const helpArticles = {
  admin: [
    { id: 1, title: 'Student management and admissions', content: 'Use Students to register learners, assign class/grade, connect parent contacts, and review profiles. Admission numbers, ELIMUIDs, grade, curriculum and parent details should be checked before saving.', keywords: ['student','admission','parent','class','elimuid'], steps: ['Open Students','Click Add Student','Fill learner and parent details','Assign class/grade','Save and confirm the profile'] },
    { id: 2, title: 'Class-based fee structures', content: 'Use Finance & Fees to create a fee structure per class, term and year. Add tuition, lunch, transport, activity or other fee items, activate the structure, assign it to students, then lock it once payments begin.', keywords: ['fees','finance','structure','class','term','lock'], steps: ['Open Finance & Fees','Create Fee Structure','Select class, term and year','Add fee items','Activate and assign','Lock after confirmation'] },
    { id: 3, title: 'Payment settings and reconciliation', content: 'School fee money should go directly to the school account. Configure MPESA Paybill/Till or bank details under Finance & Fees, then use payment records to reconcile confirmed transactions and balances.', keywords: ['mpesa','daraja','paybill','bank','reconcile'], steps: ['Open Finance & Fees','Open Payment Settings','Enter school account details','Save','Review Payment Records'] },
    { id: 4, title: 'Teacher assignments', content: 'Assign teachers to classes and subjects so they can see the correct students, timetable and Enter Marks screens. A teacher can only enter marks for assigned classes/subjects unless they are the class teacher.', keywords: ['teacher','assignment','subject','class teacher'], steps: ['Open Classes','Select a class','Assign class teacher','Assign subject teachers','Save'] },
    { id: 5, title: 'Academic reports and publishing marks', content: 'Marks should be saved as drafts first. Published marks feed reports, analytics and parent/student dashboards. Avoid editing published marks unless an admin-approved correction is logged.', keywords: ['marks','reports','publish','draft','lock'], steps: ['Teachers enter marks','Review draft marks','Publish final marks','Generate reports'] },
    { id: 6, title: 'Attendance and alerts', content: 'Attendance records affect dashboards, parent alerts and analytics. Mark students accurately, review absences, and use alerts to notify parents or administrators when patterns appear.', keywords: ['attendance','alerts','absence','late'], steps: ['Open Attendance','Mark status','Save','Review analytics and alerts'] },
    { id: 7, title: 'Timetable management', content: 'Use Timetable to generate, edit and publish class/teacher schedules. Generation depends on classes, subjects and teacher assignments. Edit visible periods, subjects, teachers, rooms and times before publishing.', keywords: ['timetable','periods','generate','teacher','class'], steps: ['Open Timetable','Generate timetable','Review grid','Edit periods/lessons','Save or publish'] },
    { id: 8, title: 'Grouped fee structures for multiple classes', content: 'Create one fee structure, tick one or many classes, and save. The structure stays as one grouped card. Open View Classes or Edit to add or remove classes later. Activating it generates individual fee accounts for every student in the selected classes.', keywords: ['finance','fees','grouped','classes','fee structure'], steps: ['Open Finance & Fees','Create Fee Structure','Tick classes','Save','Activate','Use View Classes/Edit to manage classes'] },
    { id: 9, title: 'Recording cash, bank, card and manual M-Pesa payments', content: 'Use Payment Records, select the individual student, then Record Payment. Choose Cash, Bank, Card, Manual M-Pesa or Adjustment. Approved payments update only that student fee account and appear in that student history.', keywords: ['cash','bank','card','manual mpesa','payment history','student'], steps: ['Open Finance & Fees','Payment Records','Find student','Record Payment','Choose method','Save'] },
    { id: 10, title: 'Bursaries, waivers and credits', content: 'Bursaries and waivers are credits, not parent-paid money. Add Bursary/Credit on the selected student. Approved credits reduce the balance but are shown separately from parent payments.', keywords: ['bursary','waiver','credit','scholarship'], steps: ['Open Payment Records','Find student','Add Bursary/Credit','Enter source/reference','Approve or save pending'] },
    { id: 11, title: 'AI parent alert suggestions', content: 'When sending messages to parents, select the topic, audience and tone, write a brief description, then click Get Shule AI Suggestion. The message is AI-assisted, editable before sending, and limited by the school subscription.', keywords: ['ai','alerts','parents','announcement','suggestion'], steps: ['Open Send Parent Message','Choose audience/topic/tone','Write brief description','Get Shule AI Suggestion','Edit and send'] }
  ],
  teacher: [
    { id: 1, title: 'Enter Marks workflow', content: 'Open Enter Marks, choose class, subject, term and assessment, then load students. Enter valid scores, save drafts, review totals/grades and publish only when final. Published marks appear in reports and analytics.', keywords: ['marks','enter marks','draft','publish','assessment'], steps: ['Open Enter Marks','Select class and subject','Choose term/assessment','Load students','Enter scores','Save draft','Publish when final'] },
    { id: 2, title: 'Loading your students', content: 'Your student list comes from your class-teacher assignment or subject assignment. If the list is empty, ask the admin to confirm your class/subject assignment.', keywords: ['students','my class','assignment','class teacher'], steps: ['Open My Students','Check assigned class/subject','Ask admin if no learners appear'] },
    { id: 3, title: 'Taking attendance', content: 'Use Attendance to mark learners as present, absent or late. Save once per day. Corrections should include a reason so records stay reliable.', keywords: ['attendance','present','absent','late'], steps: ['Open Attendance','Select date/class','Mark each learner','Save'] },
    { id: 4, title: 'Homework management', content: 'Use Homework to create assignments, set due dates, attach instructions and review submissions. Submitted work feeds teacher and student dashboards.', keywords: ['homework','assignment','due date','submission'], steps: ['Open Homework','Create assignment','Set due date','Save','Review submissions'] },
    { id: 5, title: 'Teacher timetable', content: 'Your timetable shows lessons assigned to you. If a subject or class is missing, ask the admin to update class and subject assignments.', keywords: ['timetable','lesson','period','subject'], steps: ['Open Timetable','Review lessons','Report missing assignments to admin'] },
    { id: 6, title: 'Duty management', content: 'Use Duty to view today’s duty, check in, check out, and review duty history. The system tracks fairness and reliability.', keywords: ['duty','check in','check out','roster'], steps: ['Open Duty','Check today’s assignment','Check in','Check out'] }
  ],
  parent: [
    { id: 1, title: 'Viewing child progress', content: 'The parent dashboard shows your child’s attendance, marks, reports and fee balance. Select the child if you have more than one learner linked.', keywords: ['child','progress','marks','attendance','reports'], steps: ['Open Dashboard','Select child','Review progress cards','Open reports or marks'] },
    { id: 2, title: 'Payments and balances', content: 'Open Payments, select one child, then review only that child’s fee accounts, balances and payment history. Use filters for All, Pending, Successful, Failed, Rejected and Bursaries/Credits. School fees and child subscriptions are shown separately.', keywords: ['payments','fees','balance','mpesa','history','subscription'], steps: ['Open Payments','Select child','Choose fee account/term','Review total, paid and balance','Filter history by status'] },
    { id: 5, title: 'Payment status meanings', content: 'Pending means the school has not verified it yet. Successful/Approved means the payment reduced the balance. Failed or Rejected attempts are saved in history but do not reduce the balance. Bursaries/Credits reduce balance only after approval.', keywords: ['pending','successful','failed','rejected','bursary'], steps: ['Open Payments','Select child','Open Payment History','Choose a status filter'] },
    { id: 3, title: 'Attendance alerts', content: 'Attendance alerts show absence, lateness or irregular attendance patterns. Contact the school if an attendance record is incorrect.', keywords: ['attendance','absence','late','alert'], steps: ['Open Attendance','Review alerts','Contact school if needed'] },
    { id: 4, title: 'Child AI tutor subscription', content: 'AI Tutor starts from Premium. Basic includes report cards, attendance and progress only. Premium gives the child 6 AI Tutor messages per day, while Ultimate gives extended tutor access and stronger child insights.', keywords: ['ai','tutor','subscription','basic','premium','ultimate'], steps: ['Open Payments or Subscriptions','Select child','Activate Premium or Ultimate for AI Tutor','Student uses AI Tutor from their own account'] }
  ],
  student: [
    { id: 1, title: 'Using the AI Tutor', content: 'Ask clear questions by subject and topic. AI Tutor access starts from an active Premium or Ultimate child subscription. Basic includes report cards, attendance and progress only. Only successful AI answers count against your limit.', keywords: ['ai','tutor','quiz','revise','homework','premium','ultimate'], steps: ['Open AI Tutor','Type your question','Ask for examples or practice','Review usage remaining'] },
    { id: 2, title: 'Checking marks and reports', content: 'Marks and reports appear after teachers publish them. Draft marks may not be visible until finalized.', keywords: ['marks','reports','grades','published'], steps: ['Open Marks or Reports','Select term','Review subject performance'] },
    { id: 3, title: 'Viewing timetable and homework', content: 'Use Timetable to know lessons and Homework to view tasks and due dates. Complete and submit assignments before deadlines.', keywords: ['timetable','homework','due date','assignments'], steps: ['Open Timetable','Open Homework','Complete tasks','Submit before due date'] },
    { id: 4, title: 'Badges and progress', content: 'Badges, points and progress indicators show learning activity. They support motivation but do not replace official academic records.', keywords: ['badges','points','progress','gamification'], steps: ['Open Progress','Review badges','Keep completing learning tasks'] }
  ]
};

// @desc    Get help articles for user role
// @route   GET /api/help/articles
// @access  Private
exports.getArticles = async (req, res) => {
  try {
    const role = req.user.role;
    const articles = helpArticles[role] || helpArticles.admin;
    res.json({ success: true, data: articles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Search help articles
// @route   GET /api/help/search
// @access  Private
exports.searchArticles = async (req, res) => {
  try {
    const { q } = req.query;
    const role = req.user.role;
    const articles = helpArticles[role] || helpArticles.admin;
    
    if (!q) {
      return res.json({ success: true, data: articles });
    }
    
    const searchTerm = q.toLowerCase();
    const filtered = articles.filter(article => 
      article.title.toLowerCase().includes(searchTerm) ||
      article.content.toLowerCase().includes(searchTerm) ||
      article.keywords.some(k => k.toLowerCase().includes(searchTerm))
    );
    
    res.json({ success: true, data: filtered });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single article by ID
// @route   GET /api/help/articles/:id
// @access  Private
exports.getArticle = async (req, res) => {
  try {
    const { id } = req.params;
    const role = req.user.role;
    const articles = helpArticles[role] || helpArticles.admin;
    const article = articles.find(a => a.id === parseInt(id));
    
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }
    
    res.json({ success: true, data: article });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
