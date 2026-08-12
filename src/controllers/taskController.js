// src/controllers/taskController.js
const { Task, User } = require('../models');
const { createAlert } = require('../services/notificationService');

// @desc    Get user's tasks
// @route   GET /api/tasks
// @access  Private
exports.getTasks = async (req, res) => {
  try {
    // Use userId column instead of teacherId
    const tasks = await Task.findAll({
      where: { userId: req.user.id },
      order: [['dueDate', 'ASC'], ['createdAt', 'DESC']]
    });
    res.json({ success: true, data: tasks });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a new task
// @route   POST /api/tasks
// @access  Private
exports.createTask = async (req, res) => {
  try {
    const { title, description, dueDate, priority, category } = req.body;
    
    if (!title) {
      return res.status(400).json({ success: false, message: 'Task title is required' });
    }
    
    // Use userId column instead of teacherId
    const task = await Task.create({
      userId: req.user.id,
      title,
      description: description || null,
      dueDate: dueDate || null,
      priority: priority || 'medium',
      status: 'pending',
      category: category || 'general'
    });
    
    // Create reminder alert if due date is soon (within 3 days)
    if (dueDate) {
      const due = new Date(dueDate);
      const now = new Date();
      const daysUntilDue = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
      
      if (daysUntilDue <= 3 && daysUntilDue >= 0) {
        await createAlert({
          userId: req.user.id,
          role: req.user.role,
          type: 'system',
          severity: daysUntilDue <= 1 ? 'warning' : 'info',
          title: 'Task Due Soon',
          message: `"${title}" is due in ${daysUntilDue} day(s)`,
          data: { taskId: task.id }
        });
      }
    }
    
    res.status(201).json({ success: true, data: task });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a task
// @route   PUT /api/tasks/:id
// @access  Private
exports.updateTask = async (req, res) => {
  try {
    const id = req.params.id || req.params.taskId;
    const task = await Task.findOne({ where: { id, userId: req.user.id } });
    
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found or not assigned to you' });
    }
    
    const safeBody = { ...(req.body || {}) };
    delete safeBody.id;
    delete safeBody.userId;
    delete safeBody.createdAt;
    delete safeBody.updatedAt;
    // Teacher personal tasks are controlled by the owning teacher. Completion can be
    // changed from the teacher's own task section only because this query is locked
    // to userId = logged-in user. Official/admin/school-assigned tasks must not be
    // stored in this personal Tasks table.
    if (safeBody.status === 'completed' && !task.completedAt) safeBody.completedAt = new Date();
    if (safeBody.status && safeBody.status !== 'completed') safeBody.completedAt = null;
    await task.update(safeBody);
    res.json({ success: true, data: task });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a task
// @route   DELETE /api/tasks/:id
// @access  Private
exports.deleteTask = async (req, res) => {
  try {
    const id = req.params.id || req.params.taskId;
    const task = await Task.findOne({ where: { id, userId: req.user.id } });
    
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found or not assigned to you' });
    }
    
    await task.destroy();
    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Complete a task
// @route   POST /api/tasks/:id/complete
// @access  Private
exports.completeTask = async (req, res) => {
  try {
    const id = req.params.id || req.params.taskId;
    const task = await Task.findOne({ where: { id, userId: req.user.id } });
    
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found or not assigned to you' });
    }
    
    // This endpoint is for the logged-in user's own personal task only.
    // The lookup above enforces task.userId === req.user.id, so a teacher can
    // complete their own task but cannot complete any other user's task.
    task.status = 'completed';
    task.completedAt = new Date();
    await task.save();
    
    // Create completion alert
    await createAlert({
      userId: req.user.id,
      role: req.user.role,
      type: 'system',
      severity: 'success',
      title: 'Task Completed',
      message: `Task "${task.title}" has been marked as completed.`,
      data: { taskId: task.id }
    });
    
    res.json({ success: true, data: task });
  } catch (error) {
    console.error('Complete task error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
