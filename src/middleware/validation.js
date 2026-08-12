const { body, validationResult } = require('express-validator');
const { assertStrongPassword } = require('../utils/passwordPolicy');

const strongPassword = field => body(field).custom((value, { req }) => {
  assertStrongPassword(value, [req.body?.name, req.body?.email, req.body?.phone, req.body?.studentElimuid, req.body?.elimuid]);
  return true;
});

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

const validationRules = {
  superAdminLogin: [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
    body('secretKey').notEmpty().withMessage('Super admin secret key is required')
  ],
  
  adminSignup: [
    body('name').notEmpty().isLength({ min: 2, max: 100 }).trim(),
    body('email').isEmail().normalizeEmail(),
    strongPassword('password'),
    body('phone').optional().isMobilePhone('any'),
    body('schoolName').notEmpty().isLength({ min: 3, max: 200 }).trim(),
    body('schoolLevel').isIn(['primary', 'secondary', 'both']),
    body('curriculum').isIn(['cbc', '844', 'british', 'american']),
    body('address').optional().isObject(),
    body('contact').optional().isObject()
  ],
  
  teacherSignup: [
    body('name').notEmpty().isLength({ min: 2, max: 100 }).trim(),
    body('email').isEmail().normalizeEmail(),
    strongPassword('password'),
    body('phone').optional().isMobilePhone('any'),
    body('schoolCode').notEmpty().withMessage('School code is required'),
    body('subjects').optional().isArray(),
    body('qualification').optional().trim()
  ],
  
  parentSignup: [
    body('name').notEmpty().isLength({ min: 2, max: 100 }).trim(),
    body('email').isEmail().normalizeEmail(),
    strongPassword('password'),
    body('phone').optional().isMobilePhone('any'),
    body('studentElimuid').notEmpty().withMessage('Student ELIMUID is required')
  ],
  
  studentLogin: [
    body('elimuid').notEmpty().withMessage('ELIMUID is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  
  login: [
    body('email').optional().isEmail().normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
    body('role').isIn(['admin', 'finance_officer', 'teacher', 'parent'])
  ],
  
  verifySchoolCode: [
    body('schoolCode').notEmpty().withMessage('School code is required')
  ],
  
  changePassword: [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    strongPassword('newPassword')
  ],
  
  approveTeacher: [
    body('action').isIn(['approve', 'reject']),
    body('rejectionReason').if(body('action').equals('reject')).notEmpty()
  ]
};

module.exports = { validate, validationRules };
