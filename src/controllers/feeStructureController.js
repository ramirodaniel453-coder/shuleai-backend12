const { FeeStructure, Fee, Student, Class, User } = require('../models');
const service = require('../services/feeStructureService');
const ledger = require('../services/financeLedgerService');

function schoolCode(req){return req.user?.role==='super_admin'?(req.query.schoolCode||req.body.schoolCode||req.user.schoolCode):req.user?.schoolCode;}

exports.list = async (req, res) => {
  try {
    const where = { schoolCode: schoolCode(req) };
    if (req.query.term) where.term = req.query.term;
    if (req.query.year) where.year = Number(req.query.year);
    if (req.query.className) where.className = req.query.className;
    const data = await FeeStructure.findAll({ where, order: [['year', 'DESC'], ['term', 'ASC'], ['className', 'ASC']] });
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

exports.get = async (req, res) => {
  try {
    const data = await FeeStructure.findOne({ where: { id: req.params.id, schoolCode: schoolCode(req) } });
    if (!data) return res.status(404).json({ success: false, message: 'Fee structure not found' });
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

exports.create = async (req, res) => {
  try {
    const data = await service.createOrUpdateStructure({ user: req.user, payload: req.body });
    res.status(201).json({ success: true, message: 'Fee structure created', data });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.update = async (req, res) => {
  try {
    const data = await service.createOrUpdateStructure({ user: req.user, id: req.params.id, payload: req.body });
    res.json({ success: true, message: 'Fee structure updated', data });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.activate = async (req, res) => {
  try { const data = await service.activateStructure({ user: req.user, id: req.params.id }); res.json({ success: true, message: 'Fee structure activated', data }); }
  catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.lock = async (req, res) => {
  try { const data = await service.lockStructure({ user: req.user, id: req.params.id }); res.json({ success: true, message: 'Fee structure locked', data }); }
  catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.assign = async (req, res) => {
  try {
    const data = await service.assignStructureToStudents({ user: req.user, structureId: req.params.id, studentIds: req.body.studentIds || [], classId: req.body.classId || null, overwrite: req.body.overwrite === true });
    res.json({ success: true, message: 'Fee structure assigned', data });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};


exports.delete = async (req, res) => {
  try {
    const data = await service.deleteOrArchiveStructure({ user: req.user, id: req.params.id });
    res.json({ success: true, message: data.action === 'deleted' ? 'Fee structure deleted' : 'Fee structure archived because accounts or payments already exist', data });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.adjustFee = async (req, res) => {
  try {
    const data = await service.adjustStudentFee({ user: req.user, feeId: req.params.feeId, amount: req.body.amount, reason: req.body.reason, type: req.body.type });
    res.json({ success: true, message: 'Fee adjusted with audit log', data });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
};

exports.studentFeeAccounts = async (req, res) => {
  try {
    const where = { schoolCode: schoolCode(req) };
    if (req.query.studentId) where.studentId = req.query.studentId;
    if (req.query.term) where.term = req.query.term;
    if (req.query.year) where.year = Number(req.query.year);
    if (req.query.feeStructureId) {
      const feeStructureId = Number(req.query.feeStructureId);
      if (!Number.isSafeInteger(feeStructureId) || feeStructureId < 1) return res.status(400).json({ success:false, message:'feeStructureId must be a positive integer' });
      where.feeStructureId = feeStructureId;
    }
    const rows = await Fee.findAll({
      where,
      include: [{ model: Student, include: [{ model: User, attributes: ['id','name','email','schoolCode'] }, { model: Class, attributes:['id','name','grade','stream'], required:false }] }],
      order: [['year', 'DESC'], ['term', 'DESC'], ['updatedAt', 'DESC']]
    });
    const data = rows.map(row => ledger.decorateFeeAccount(row, row.Student));
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
