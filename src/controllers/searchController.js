const { Op } = require('sequelize');
const { User, Student, Teacher, Class, School } = require('../models');

exports.globalSearch = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ success: true, data: { students: [], teachers: [], classes: [] } });
    }

    const schoolCode = req.user.schoolCode;
    const searchTerm = `%${q}%`;

    // Students
    const students = await Student.findAll({
      include: [{
        model: User,
        where: {
          schoolCode,
          [Op.or]: [
            { name: { [Op.iLike]: searchTerm } },
            { email: { [Op.iLike]: searchTerm } }
          ]
        },
        attributes: ['id', 'name', 'email']
      }],
      where: {
        [Op.or]: [
          { elimuid: { [Op.iLike]: searchTerm } }
        ]
      },
      limit: 10
    });

    // Teachers
    const teachers = await Teacher.findAll({
      include: [{
        model: User,
        where: {
          schoolCode,
          role: 'teacher',
          [Op.or]: [
            { name: { [Op.iLike]: searchTerm } },
            { email: { [Op.iLike]: searchTerm } }
          ]
        },
        attributes: ['id', 'name', 'email']
      }],
      where: {
        [Op.or]: [
          { employeeId: { [Op.iLike]: searchTerm } }
        ]
      },
      limit: 10
    });

    // Classes
    const classes = await Class.findAll({
      where: {
        schoolCode,
        isActive: true,
        [Op.or]: [
          { name: { [Op.iLike]: searchTerm } },
          { grade: { [Op.iLike]: searchTerm } }
        ]
      },
      limit: 10
    });

    const formatStudent = (s) => ({
      id: s.id,
      name: s.User.name,
      elimuid: s.elimuid,
      grade: s.grade,
      photo: s.User.profileImage
    });

    const formatTeacher = (t) => ({
      id: t.id,
      name: t.User.name,
      email: t.User.email,
      employeeId: t.employeeId
    });

    const formatClass = (c) => ({
      id: c.id,
      name: c.name,
      grade: c.grade,
      stream: c.stream
    });

    res.json({
      success: true,
      data: {
        students: students.map(formatStudent),
        teachers: teachers.map(formatTeacher),
        classes: classes.map(formatClass)
      }
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
};
