const { Op, Sequelize } = require('sequelize');
const { sequelize } = require('../models');
const {
    Student, AcademicRecord, Attendance, School, Teacher, User,
    Class, Payment, Fee, Parent, Competency, LearningOutcome,
    StudentCompetencyProgress, DutyRoster, HomeTaskAssignment, HomeTask,
    ConductLog, ResourceViews, MoodCheckin, Message
} = require('../models');
const moment = require('moment');
const gradingEngine = require('../services/gradingEngine');


async function ensureAnalyticsSchema() { return true; }

function isSchemaColumnError(error) {
    const message = String(error?.original?.message || error?.message || error || '');
    return message.includes('classId') || message.includes('schoolCode') || message.includes('column') || message.includes('does not exist');
}

// ---------- SUPER ADMIN ANALYTICS ----------
exports.getSuperAdminAnalytics = async (req, res) => {
    try {
        const totalSchools = await School.count();
        const activeSchools = await School.count({ where: { status: 'active' } });
        const pendingSchools = await School.count({ where: { status: 'pending' } });
        const totalStudents = await Student.count();
        const totalTeachers = await Teacher.count();

        const startOfMonth = moment().startOf('month').toDate();
        const revenueMTD = await Payment.sum('amount', {
            where: { status: 'completed', createdAt: { [Op.gte]: startOfMonth } }
        }) || 0;

        const sixMonthsAgo = moment().subtract(6, 'months').startOf('month').toDate();
        const schoolsByMonth = await School.findAll({
            attributes: [[sequelize.fn('DATE_TRUNC', 'month', sequelize.col('createdAt')), 'month'], [sequelize.fn('COUNT', '*'), 'count']],
            where: { createdAt: { [Op.gte]: sixMonthsAgo } },
            group: ['month'], order: [['month', 'ASC']], raw: true
        });
        const growthLabels = [], growthValues = [];
        for (let i = 5; i >= 0; i--) {
            const month = moment().subtract(i, 'months').format('MMM');
            growthLabels.push(month);
            const found = schoolsByMonth.find(s => moment(s.month).format('MMM') === month);
            growthValues.push(found ? parseInt(found.count) : 0);
        }

        const revenueByMonth = await Payment.findAll({
            attributes: [[sequelize.fn('DATE_TRUNC', 'month', sequelize.col('createdAt')), 'month'], [sequelize.fn('SUM', sequelize.col('amount')), 'total']],
            where: { status: 'completed', createdAt: { [Op.gte]: sixMonthsAgo } },
            group: ['month'], order: [['month', 'ASC']], raw: true
        });
        const revenueLabels = [], revenueValues = [];
        for (let i = 5; i >= 0; i--) {
            const month = moment().subtract(i, 'months').format('MMM');
            revenueLabels.push(month);
            const found = revenueByMonth.find(r => moment(r.month).format('MMM') === month);
            revenueValues.push(found ? parseFloat(found.total) : 0);
        }

        const schools = await School.findAll({ attributes: ['settings'] });
        const levelCounts = { primary: 0, secondary: 0, both: 0 };
        schools.forEach(s => {
            const level = s.settings?.schoolLevel || 'secondary';
            levelCounts[level] = (levelCounts[level] || 0) + 1;
        });

        const curriculumCounts = await School.findAll({
            attributes: ['system', [sequelize.fn('COUNT', '*'), 'count']],
            group: ['system'], raw: true
        });
        const curriculumMap = { cbc: 0, '844': 0, british: 0, american: 0 };
        curriculumCounts.forEach(c => { curriculumMap[c.system] = parseInt(c.count); });

        res.json({ success: true, data: { overview: { totalSchools, activeSchools, pendingSchools, totalStudents, totalTeachers, revenueMTD }, growth: { labels: growthLabels, values: growthValues }, revenueTrend: { labels: revenueLabels, values: revenueValues }, distributionByLevel: levelCounts, distributionByCurriculum: curriculumMap } });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};


async function getAdminAnalyticsSafeFallback(schoolCode) {
    const q = async (sql, replacements = {}) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
    const scalar = async (sql, replacements = {}) => {
        const rows = await q(sql, replacements);
        const first = rows[0] || {};
        return Number(first.count ?? first.total ?? first.value ?? 0) || 0;
    };
    const totalStudents = await scalar('SELECT COUNT(*) AS count FROM "Students" s JOIN "Users" u ON u.id = s."userId" WHERE u."schoolCode" = :schoolCode', { schoolCode }).catch(() => 0);
    const totalTeachers = await scalar('SELECT COUNT(*) AS count FROM "Teachers" t JOIN "Users" u ON u.id = t."userId" WHERE u."schoolCode" = :schoolCode AND u.role = \'teacher\'', { schoolCode }).catch(() => 0);
    const totalClasses = await scalar('SELECT COUNT(*) AS count FROM "Classes" WHERE "schoolCode" = :schoolCode AND COALESCE("isActive", true) = true', { schoolCode }).catch(() => 0);
    const attendanceRows = await q('SELECT status, COUNT(*) AS count FROM "Attendances" WHERE "schoolCode" = :schoolCode AND date >= CURRENT_DATE - INTERVAL \'30 days\' GROUP BY status', { schoolCode }).catch(() => []);
    const attendanceTotal = attendanceRows.reduce((s, r) => s + Number(r.count || 0), 0);
    const present = attendanceRows.find(r => r.status === 'present')?.count || 0;
    const attendanceRate = attendanceTotal ? Math.round((Number(present) / attendanceTotal) * 100) : 0;
    const feeRows = await q('SELECT COALESCE(SUM("totalAmount"),0) AS total, COALESCE(SUM("paidAmount"),0) AS paid FROM "Fees" WHERE "schoolCode" = :schoolCode', { schoolCode }).catch(() => [{ total: 0, paid: 0 }]);
    const totalFees = Number(feeRows[0]?.total || 0);
    const paidFees = Number(feeRows[0]?.paid || 0);
    const feeCollectionRate = totalFees ? Math.round((paidFees / totalFees) * 100) : 0;
    const feeStatusRows = await q('SELECT status, COUNT(*) AS count FROM "Fees" WHERE "schoolCode" = :schoolCode GROUP BY status', { schoolCode }).catch(() => []);
    const feeStatus = { paid: 0, partial: 0, unpaid: 0 };
    feeStatusRows.forEach(r => { feeStatus[r.status] = Number(r.count || 0); });
    return {
        overview: { totalStudents, totalTeachers, totalClasses, attendanceRate, feeCollectionRate },
        enrollmentTrend: { labels: [], values: [] },
        gradeDistribution: { labels: [], values: [] },
        attendanceByGrade: { labels: [], values: [] },
        feeStatus,
        teacherWorkload: [],
        parentEngagement: [],
        tardinessTrend: { labels: ['Monday','Tuesday','Wednesday','Thursday','Friday'], values: [0,0,0,0,0] },
        submitPattern: { onTime: 0, late: 0 }
    };
}

// ---------- ADMIN ANALYTICS (extended) ----------
exports.getAdminAnalytics = async (req, res) => {
    try {
        await ensureAnalyticsSchema();
        const schoolCode = req.user.schoolCode;
        const school = await School.findOne({ where: { schoolId: schoolCode } });
        if (!school) return res.status(404).json({ success: false, message: 'School not found' });

        const totalStudents = await Student.count({ include: [{ model: User, where: { schoolCode } }] });
        const totalTeachers = await Teacher.count({ include: [{ model: User, where: { schoolCode, role: 'teacher' } }] });
        const totalClasses = await Class.count({ where: { schoolCode, isActive: true } });

        const thirtyDaysAgo = moment().subtract(30, 'days').format('YYYY-MM-DD');
        const attendanceRecords = await Attendance.findAll({ where: { schoolCode, date: { [Op.gte]: thirtyDaysAgo } } });
        const presentCount = attendanceRecords.filter(a => a.status === 'present').length;
        const attendanceRate = attendanceRecords.length ? Math.round((presentCount / attendanceRecords.length) * 100) : 0;

        const fees = await Fee.findAll({ where: { schoolCode } });
        const totalFees = fees.reduce((sum, f) => sum + f.totalAmount, 0);
        const paidFees = fees.reduce((sum, f) => sum + f.paidAmount, 0);
        const feeCollectionRate = totalFees ? Math.round((paidFees / totalFees) * 100) : 0;

        // Enrollment trend
        const enrollmentTrend = { labels: [], values: [] };
        const currentYear = new Date().getFullYear();
        const terms = ['Term 1', 'Term 2', 'Term 3'];
        for (let year = currentYear - 1; year <= currentYear; year++) {
            for (const term of terms) {
                enrollmentTrend.labels.push(`${term} ${year}`);
                const count = await AcademicRecord.count({ distinct: true, col: 'studentId', where: { schoolCode, term, year } });
                enrollmentTrend.values.push(count);
            }
        }

        // Grade distribution
        const records = await AcademicRecord.findAll({ where: { schoolCode } });
        const gradeCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
        records.forEach(r => {
            const g = r.grade?.[0]?.toUpperCase() || 'E';
            if (gradeCounts.hasOwnProperty(g)) gradeCounts[g]++;
        });

        // Attendance by grade
        const students = await Student.findAll({ include: [{ model: User, where: { schoolCode } }] });
        const gradeAttendance = {};
        for (const student of students) {
            const att = await Attendance.findAll({ where: { studentId: student.id } });
            const present = att.filter(a => a.status === 'present').length;
            const rate = att.length ? Math.round((present / att.length) * 100) : 0;
            if (!gradeAttendance[student.grade]) gradeAttendance[student.grade] = { total: 0, count: 0 };
            gradeAttendance[student.grade].total += rate;
            gradeAttendance[student.grade].count++;
        }
        const attendanceByGrade = {
            labels: Object.keys(gradeAttendance),
            values: Object.values(gradeAttendance).map(g => Math.round(g.total / g.count))
        };

        // Fee status
        const feeStatus = { paid: 0, partial: 0, unpaid: 0 };
        fees.forEach(f => {
            if (f.status === 'paid') feeStatus.paid++;
            else if (f.status === 'partial') feeStatus.partial++;
            else feeStatus.unpaid++;
        });

        // Teacher workload (duty)
        const teacherWorkload = await Teacher.findAll({
            include: [{ model: User, where: { schoolCode, role: 'teacher' }, attributes: ['name'] }]
        });
        const workloadData = teacherWorkload.map(t => ({
            name: t.User.name,
            monthlyDutyCount: t.statistics?.monthlyDutyCount || 0,
            reliabilityScore: t.statistics?.reliabilityScore || 100
        }));

        // Parental engagement: count logins of parents
        const parentLogins = await User.findAll({
            where: { schoolCode, role: 'parent' },
            attributes: ['loginCount', 'name']
        });
        const engagementData = parentLogins.map(p => ({ name: p.name, logins: p.loginCount || 0 }));

        // Tardiness trends: count late by day of week
        const lateRecords = await Attendance.findAll({
            where: { schoolCode, status: 'late', date: { [Op.gte]: thirtyDaysAgo } }
        });
        const dayCounts = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0 };
        lateRecords.forEach(a => {
            const day = moment(a.date).format('dddd');
            if (dayCounts.hasOwnProperty(day)) dayCounts[day]++;
        });
        const tardinessTrend = { labels: Object.keys(dayCounts), values: Object.values(dayCounts) };

        // Submit pattern: count homework submitted on time vs late
        const assignments = await HomeTaskAssignment.findAll({
            include: [{ model: HomeTask, attributes: ['dueDate'] }],
            where: { status: 'submitted' }
        });
        let onTime = 0, late = 0;
        assignments.forEach(a => {
            if (a.completedAt && a.HomeTask?.dueDate) {
                if (new Date(a.completedAt) <= new Date(a.HomeTask.dueDate)) onTime++;
                else late++;
            }
        });
        const submitPattern = { onTime, late };

        res.json({ success: true, data: { overview: { totalStudents, totalTeachers, totalClasses, attendanceRate, feeCollectionRate }, enrollmentTrend, gradeDistribution: { labels: Object.keys(gradeCounts), values: Object.values(gradeCounts) }, attendanceByGrade, feeStatus, teacherWorkload: workloadData, parentEngagement: engagementData, tardinessTrend, submitPattern } });
    } catch (error) {
        const message = String(error?.original?.message || error?.message || error);
        console.error('Admin analytics error:', message);
        if (message.includes('classId') || message.includes('column')) {
            try {
                await ensureAnalyticsRuntimeColumns();
                const data = await getAdminAnalyticsSafeFallback(req.user.schoolCode);
                return res.json({ success: true, data, repaired: true });
            } catch (fallbackError) {
                console.error('Admin analytics fallback error:', fallbackError);
            }
        }
        res.status(500).json({ success: false, message });
    }
};

// ---------- TEACHER ANALYTICS (extended) ----------
exports.getTeacherAnalytics = async (req, res) => {
    try {
        await ensureAnalyticsSchema();
        const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
        if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

        const classItem = await Class.findOne({ where: { teacherId: teacher.id } });
        let classNames = [];
        if (classItem) classNames.push(classItem.name);
        const allClasses = await Class.findAll({ where: { schoolCode: req.user.schoolCode } });
        allClasses.forEach(cls => {
            if (cls.subjectTeachers?.some(st => st.teacherId === teacher.id)) {
                classNames.push(cls.name);
            }
        });
        classNames = [...new Set(classNames)];
        const students = await Student.findAll({
            where: { grade: { [Op.in]: classNames } },
            include: [{ model: User, attributes: ['name'] }]
        });
        const studentIds = students.map(s => s.id);
        const studentCount = students.length;

        const records = await AcademicRecord.findAll({ where: { studentId: { [Op.in]: studentIds } } });
        const classAverage = records.length ? Math.round(records.reduce((s, r) => s + r.score, 0) / records.length) : 0;

        // Subject averages
        const subjectMap = {};
        records.forEach(r => {
            if (!subjectMap[r.subject]) subjectMap[r.subject] = { total: 0, count: 0 };
            subjectMap[r.subject].total += r.score;
            subjectMap[r.subject].count++;
        });
        const subjectAverages = Object.entries(subjectMap).map(([sub, d]) => ({ subject: sub, average: Math.round(d.total / d.count) }));

        // Attendance trend (last 7 days)
        const last7Days = [];
        for (let i = 6; i >= 0; i--) last7Days.push(moment().subtract(i, 'days').format('YYYY-MM-DD'));
        const attendanceTrend = { labels: [], values: [] };
        for (const date of last7Days) {
            const dayAttendance = await Attendance.findAll({ where: { studentId: { [Op.in]: studentIds }, date } });
            const present = dayAttendance.filter(a => a.status === 'present').length;
            const rate = dayAttendance.length ? Math.round((present / dayAttendance.length) * 100) : 0;
            attendanceTrend.labels.push(moment(date).format('ddd'));
            attendanceTrend.values.push(rate);
        }

        // Grade distribution
        const gradeCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
        records.forEach(r => {
            const g = r.grade?.[0]?.toUpperCase() || 'E';
            if (gradeCounts.hasOwnProperty(g)) gradeCounts[g]++;
        });

        // Student performance list
        const studentPerformance = students.map(s => {
            const studentRecords = records.filter(r => r.studentId === s.id);
            const avg = studentRecords.length ? Math.round(studentRecords.reduce((sum, r) => sum + r.score, 0) / studentRecords.length) : 0;
            return { name: s.User.name, average: avg };
        }).sort((a, b) => b.average - a.average);

        // Risk indicators: students whose latest 3 scores average dropped by >15% from previous 3
        const riskStudents = [];
        for (const student of students) {
            const studentRecs = records.filter(r => r.studentId === student.id).sort((a, b) => new Date(b.date) - new Date(a.date));
            if (studentRecs.length >= 6) {
                const recent3 = studentRecs.slice(0, 3);
                const previous3 = studentRecs.slice(3, 6);
                const recentAvg = recent3.reduce((s, r) => s + r.score, 0) / 3;
                const prevAvg = previous3.reduce((s, r) => s + r.score, 0) / 3;
                if (prevAvg > 0 && (prevAvg - recentAvg) / prevAvg > 0.15) {
                    riskStudents.push({ name: student.User.name, recentAvg: Math.round(recentAvg), prevAvg: Math.round(prevAvg), drop: Math.round((prevAvg - recentAvg) / prevAvg * 100) });
                }
            }
        }

        // Submission patterns: on-time vs late homework for this class
        const classAssignments = await HomeTaskAssignment.findAll({
            where: { studentId: { [Op.in]: studentIds }, status: 'submitted' },
            include: [{ model: HomeTask, attributes: ['dueDate'] }]
        });
        let onTime = 0, lateSub = 0;
        classAssignments.forEach(a => {
            if (a.completedAt && a.HomeTask?.dueDate) {
                if (new Date(a.completedAt) <= new Date(a.HomeTask.dueDate)) onTime++;
                else lateSub++;
            }
        });
        const submitPattern = { onTime, late: lateSub };

        // Conduct summary (positive/negative counts)
        const conductCounts = await ConductLog.findAll({
            where: { studentId: { [Op.in]: studentIds } },
            attributes: ['type', [sequelize.fn('COUNT', '*'), 'count']],
            group: ['type'], raw: true
        });
        const conductData = { positive: 0, negative: 0 };
        conductCounts.forEach(c => { conductData[c.type] = parseInt(c.count); });

        // Parent engagement: average logins of parents of these students
        const parentUsers = await User.findAll({
            where: { schoolCode: req.user.schoolCode, role: 'parent' },
            attributes: ['loginCount']
        });
        const avgParentLogins = parentUsers.length ? Math.round(parentUsers.reduce((s, u) => s + (u.loginCount || 0), 0) / parentUsers.length) : 0;

        res.json({ success: true, data: { overview: { studentCount, classAverage, attendanceToday: `${await Attendance.count({ where: { studentId: { [Op.in]: studentIds }, date: moment().format('YYYY-MM-DD'), status: 'present' } })}/${studentCount}` }, subjectAverages, attendanceTrend, gradeDistribution: { labels: Object.keys(gradeCounts), values: Object.values(gradeCounts) }, studentPerformance, riskStudents, submitPattern, conductData, parentEngagement: avgParentLogins } });
    } catch (error) {
        if (isSchemaColumnError(error)) return res.status(503).json({ success:false, code:'SCHEMA_MIGRATION_REQUIRED', message:'Analytics database schema is not at the required migration version.' });
        res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- PARENT ANALYTICS (extended) ----------
// Parent analytics logic moved to V17 auto-select implementation below

// ---------- STUDENT ANALYTICS (extended) ----------
// Student analytics logic moved to V17 role-aware implementation below

// --- v13.1 verified production exports ---
// The public /api/analytics routes expect these handler names. Keep them attached here
// so mounted routes never crash with "Route.get() requires a callback function".
let getClassAnalyticsHandler;
try {
    const classAnalyticsController = require('./classAnalyticsController');
    getClassAnalyticsHandler = classAnalyticsController.getClassAnalytics;
} catch (error) {
    getClassAnalyticsHandler = async (req, res) => {
        res.status(503).json({ success: false, message: 'Class analytics service is temporarily unavailable.' });
    };
}
exports.getClassAnalytics = getClassAnalyticsHandler;

exports.getSchoolAnalytics = exports.getAdminAnalytics;

exports.compareCurriculum = async (req, res) => {
    try {
        const student = await Student.findByPk(Number(req.params.studentId), { include: [{ model: User, required: true }] });
        if (!student || student.User.schoolCode !== req.user.schoolCode) return res.status(404).json({ success: false, message: 'Student not found in your school' });
        if (req.user.role === 'student' && Number(student.userId) !== Number(req.user.id)) return res.status(403).json({ success: false, message: 'You can only compare your own results' });
        if (req.user.role === 'parent') {
            const parent = await Parent.findOne({ where: { userId: req.user.id } });
            if (!parent || !(await parent.hasStudent(student))) return res.status(403).json({ success: false, message: 'Not your child' });
        }
        const school = await School.findOne({ where: { schoolId: student.User.schoolCode } });
        const records = await AcademicRecord.findAll({
            where: { studentId: student.id, ...( ['student','parent'].includes(req.user.role) ? { isPublished: true } : {} ) },
            attributes: ['subject', 'score'],
            order: [['createdAt', 'DESC']]
        });
        const validScores = records.map(row => Number(row.score)).filter(Number.isFinite);
        const average = validScores.length ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length * 100) / 100 : null;
        const curriculumHelper = require('../utils/curriculumHelper');
        const level = student.grade || school?.settings?.schoolLevel || 'primary';
        const currentCurriculum = curriculumHelper.normalizeCurriculumKey(student.curriculum || school?.system || 'cbc');
        const comparisons = ['cbc', '844', 'british', 'american'].map(curriculum => ({
            curriculum,
            grade: average === null ? 'N/A' : gradingEngine.getGradeFromScore(average, curriculum, level),
            average,
            isCurrent: curriculum === currentCurriculum
        }));
        res.json({ success: true, data: { studentId: student.id, studentName: student.User.name, level, currentCurriculum, recordCount: records.length, average, comparisons } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============ V17 OVERRIDE: role-aware student analytics ============
exports.getStudentAnalytics = async (req, res) => {
    try {
        await ensureAnalyticsSchema();
        let studentId = req.params.studentId || null;
        let student = null;

        if (req.user.role === 'student') {
            student = await Student.findOne({ where: { userId: req.user.id }, include: [{ model: User }] });
            studentId = student?.id;
        } else if (studentId) {
            student = await Student.findByPk(studentId, { include: [{ model: User }] });
            if (!student || student.User?.schoolCode !== req.user.schoolCode) {
                return res.status(404).json({ success: false, message: 'Student not found in your school' });
            }
            if (req.user.role === 'parent') {
                const parent = await Parent.findOne({ where: { userId: req.user.id } });
                if (!parent || !(await parent.hasStudent(student))) {
                    return res.status(403).json({ success: false, message: 'Not your child' });
                }
            }
        }

        if (!student || !studentId) return res.status(404).json({ success: false, message: 'Student not found' });

        const school = await School.findOne({ where: { schoolId: student.User?.schoolCode || req.user.schoolCode } });
        const curriculum = school?.system || 'cbc';
        const schoolLevel = school?.settings?.schoolLevel || 'secondary';

        const publishedOnly = req.user.role === 'parent' || req.user.role === 'student';
        const records = await AcademicRecord.findAll({
            where: { studentId, ...(publishedOnly ? { isPublished: true } : {}) },
            order: [['date', 'DESC'], ['createdAt', 'DESC']]
        });
        const overallAverage = records.length ? Math.round(records.reduce((s, r) => s + Number(r.score || 0), 0) / records.length) : 0;
        const attendance = await Attendance.findAll({ where: { studentId }, order: [['date', 'DESC']] });
        const present = attendance.filter(a => a.status === 'present').length;
        const absent = attendance.filter(a => a.status === 'absent').length;
        const late = attendance.filter(a => a.status === 'late').length;
        const attendanceRate = attendance.length ? Math.round((present / attendance.length) * 100) : 0;

        const recentRecords = records.slice(0, 10).reverse();
        const gradeTrend = { labels: recentRecords.map(r => r.assessmentName?.substring(0, 14) || r.subject || 'Assessment'), values: recentRecords.map(r => Number(r.score || 0)) };
        const subjectMap = {};
        records.forEach(r => {
            if (!subjectMap[r.subject]) subjectMap[r.subject] = { total: 0, count: 0, records:[] };
            subjectMap[r.subject].total += Number(r.score || 0);
            subjectMap[r.subject].count++;
            subjectMap[r.subject].records.push(r);
        });
        const subjectPerformance = Object.entries(subjectMap).map(([subject, d]) => {
            const score = Math.round(d.total / d.count);
            return { subject, score, average: score, grade: gradingEngine.gradeValueForRecords(score,d.records) };
        });

        const gradeCounts = {};
        records.forEach(r => {
            const g = gradingEngine.storedGrade(r) || gradingEngine.getGradeFromScore(r.score, curriculum, schoolLevel);
            gradeCounts[g] = (gradeCounts[g] || 0) + 1;
        });

        res.json({ success: true, data: {
            student: { id: student.id, name: student.User?.name, grade: student.grade, elimuid: student.elimuid, photo: student.User?.profileImage },
            curriculum, schoolLevel,
            overallAverage,
            grade: gradingEngine.gradeValueForRecords(overallAverage,records),
            attendance: { rate: attendanceRate, present, absent, late, total: attendance.length },
            attendanceRate,
            records,
            gradeTrend,
            gradeDistribution: { labels: Object.keys(gradeCounts), values: Object.values(gradeCounts) },
            subjectPerformance,
            points: student.points || 0,
            personalBest: Math.max(...records.map(r => Number(r.score || 0)), 0)
        }});
    } catch (error) {
        console.error('V17 getStudentAnalytics error:', error);
        if (isSchemaColumnError(error)) return res.status(503).json({ success:false, code:'SCHEMA_MIGRATION_REQUIRED', message:'Analytics database schema is not at the required migration version.' });
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============ V17 OVERRIDE: parent analytics can auto-select first child ============
exports.getParentAnalytics = async (req, res) => {
    try {
        await ensureAnalyticsSchema();
        const parent = await Parent.findOne({ where: { userId: req.user.id }, include: [{ model: Student, as: 'students', include: [{ model: User }] }] });
        if (!parent) return res.status(404).json({ success: false, message: 'Parent profile not found' });
        const childId = req.query.childId || parent.students?.[0]?.id;
        if (!childId) return res.json({ success: true, data: { empty: true, message: 'No child linked to this parent account' } });
        const student = parent.students.find(s => Number(s.id) === Number(childId)) || await Student.findByPk(childId, { include: [{ model: User }] });
        if (!student || !(await parent.hasStudent(student))) return res.status(403).json({ success: false, message: 'Not your child' });

        req.params.studentId = student.id;
        return exports.getStudentAnalytics(req, res);
    } catch (error) {
        console.error('V17 getParentAnalytics error:', error);
        if (isSchemaColumnError(error)) return res.status(503).json({ success:false, code:'SCHEMA_MIGRATION_REQUIRED', message:'Analytics database schema is not at the required migration version.' });
        res.status(500).json({ success: false, message: error.message });
    }
};
