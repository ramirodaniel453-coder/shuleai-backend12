const { Class, Teacher, User, School } = require('../models');
const { Op } = require('sequelize');
const cache = require('../services/cacheService');

// @desc    Get all classes in school
// @route   GET /api/admin/classes
// @access  Private/Admin
// src/controllers/classController.js
exports.getClasses = async (req, res) => {
  try {
    const cacheKey = cache.getCacheKey(['school', req.user.schoolCode, 'classes-active']);
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ success: true, cached: true, data: cached });

    const classes = await Class.findAll({
      where: {
        schoolCode: req.user.schoolCode,
        isActive: true
      },
      attributes: ['id','name','grade','stream','schoolCode','teacherId','academicYear','isActive','settings','subjectTeachers','createdAt','updatedAt'],
      include: [{
        model: Teacher,
        attributes: ['id','userId','employeeId','department','classId'],
        include: [{ model: User, attributes: ['id', 'name', 'email'] }]
      }],
      order: [['grade', 'ASC'], ['name', 'ASC']]
    });

    const classesWithData = classes.map(cls => ({
      id: cls.id,
      name: cls.name,
      grade: cls.grade,
      stream: cls.stream,
      schoolCode: cls.schoolCode,
      teacherId: cls.teacherId,
      academicYear: cls.academicYear,
      isActive: cls.isActive,
      settings: cls.settings,
      createdAt: cls.createdAt,
      updatedAt: cls.updatedAt,
      subjectTeachers: cls.subjectTeachers || [],
      Teacher: cls.Teacher
    }));

    cache.set(cacheKey, classesWithData, 300);
    res.json({ success: true, cached: false, data: classesWithData });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a new class
// @route   POST /api/admin/classes
// @access  Private/Admin
exports.createClass = async (req, res) => {
  try {
    const { name, grade, stream } = req.body;
    
    // Check if class already exists
    const existingClass = await Class.findOne({
      where: {
        schoolCode: req.user.schoolCode,
        name: name
      }
    });
    
    if (existingClass) {
      return res.status(400).json({ 
        success: false, 
        message: 'A class with this name already exists' 
      });
    }
    
    const newClass = await Class.create({
      name,
      grade,
      stream: stream || null,
      schoolCode: req.user.schoolCode,
      isActive: true
    });
    cache.flushSchoolCache(req.user.schoolCode);
    
    res.status(201).json({ 
      success: true, 
      message: 'Class created successfully',
      data: newClass 
    });
  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a class
// @route   PUT /api/admin/classes/:id
// @access  Private/Admin
exports.updateClass = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, grade, stream } = req.body;
    
    const classItem = await Class.findOne({
      where: { 
        id, 
        schoolCode: req.user.schoolCode 
      }
    });
    
    if (!classItem) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    await classItem.update({ name, grade, stream });
    cache.flushSchoolCache(req.user.schoolCode);
    
    res.json({ 
      success: true, 
      message: 'Class updated successfully',
      data: classItem 
    });
  } catch (error) {
    console.error('Update class error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a class
// @route   DELETE /api/admin/classes/:id
// @access  Private/Admin
exports.deleteClass = async (req, res) => {
  try {
    const { id } = req.params;
    
    const classItem = await Class.findOne({
      where: { 
        id, 
        schoolCode: req.user.schoolCode 
      }
    });
    
    if (!classItem) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // Soft delete
    await classItem.update({ isActive: false });
    cache.flushSchoolCache(req.user.schoolCode);
    
    res.json({ 
      success: true, 
      message: 'Class deleted successfully' 
    });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get available teachers for class assignment
// @route   GET /api/admin/available-teachers
// @access  Private/Admin
exports.getAvailableTeachers = async (req, res) => {
  try {
    const teachers = await Teacher.findAll({
      where: { approvalStatus: 'approved' },
      include: [{
        model: User,
        where: { schoolCode: req.user.schoolCode },
        attributes: ['id', 'name', 'email']
      }]
    });
    
    res.json({ success: true, data: teachers });
  } catch (error) {
    console.error('Get available teachers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Assign teacher to class
// @route   POST /api/admin/classes/:id/assign-teacher
// @access  Private/Admin
exports.assignTeacherToClass = async (req, res) => {
  try {
    const { id } = req.params;
    const { teacherId } = req.body;
    
    const classItem = await Class.findOne({
      where: { 
        id, 
        schoolCode: req.user.schoolCode 
      }
    });
    
    if (!classItem) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // Verify teacher belongs to this school
    const teacher = await Teacher.findOne({
      where: { id: teacherId },
      include: [{
        model: User,
        where: { schoolCode: req.user.schoolCode }
      }]
    });
    
    if (!teacher) {
      return res.status(404).json({ 
        success: false, 
        message: 'Teacher not found in this school' 
      });
    }
    
    // Update the class with the new teacher
    await classItem.update({ teacherId });
    
    // Also update the teacher's classTeacher field
    await teacher.update({ classTeacher: classItem.name });
    cache.flushSchoolCache(req.user.schoolCode);
    
    res.json({ 
      success: true, 
      message: 'Teacher assigned successfully',
      data: classItem 
    });
  } catch (error) {
    console.error('Assign teacher error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Remove teacher from class
// @route   POST /api/admin/classes/:id/remove-teacher
// @access  Private/Admin
exports.removeTeacherFromClass = async (req, res) => {
  try {
    const { id } = req.params;
    
    const classItem = await Class.findOne({
      where: { 
        id, 
        schoolCode: req.user.schoolCode 
      }
    });
    
    if (!classItem) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    await classItem.update({ teacherId: null });
    cache.flushSchoolCache(req.user.schoolCode);
    
    res.json({ 
      success: true, 
      message: 'Teacher removed from class successfully' 
    });
  } catch (error) {
    console.error('Remove teacher error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
