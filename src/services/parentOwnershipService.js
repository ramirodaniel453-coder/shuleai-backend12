'use strict';

const { sequelize, Parent, Student, User } = require('../models');
const { Op } = require('sequelize');

function qtype() { return sequelize.QueryTypes.SELECT; }
function asId(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }
function linkStatusSql(alias = 'sp') {
  return `COALESCE(${alias}."status", 'active') IN ('active','approved','verified','linked')`;
}

async function getParentForUser(parentUserId) {
  const uid = asId(parentUserId);
  if (!uid) return null;
  return Parent.findOne({ where: { userId: uid } });
}

async function getStudentInSchool(studentId, schoolCode, options = {}) {
  const sid = asId(studentId);
  if (!sid) return null;
  return Student.findOne({
    where: { id: sid },
    include: [{ model: User, ...(schoolCode ? { where: { schoolCode } } : {}), attributes: ['id','name','email','phone','schoolCode','profileImage'] }],
    transaction: options.transaction || undefined
  });
}

async function ownsStudentId({ parentUserId, parentId, studentId, schoolCode, transaction } = {}) {
  const sid = asId(studentId);
  const uid = asId(parentUserId);
  let pid = asId(parentId);
  if (!sid || (!uid && !pid)) return false;
  if (!pid && uid) {
    const parent = await Parent.findOne({ where: { userId: uid }, transaction }).catch(() => null);
    pid = asId(parent?.id);
  }
  if (!pid) return false;
  const rows = await sequelize.query(
    `SELECT 1
       FROM "StudentParents" sp
       JOIN "Parents" p ON p."id" = sp."parentId"
       JOIN "Students" s ON s."id" = sp."studentId"
       JOIN "Users" su ON su."id" = s."userId"
      WHERE sp."studentId" = :studentId
        AND sp."parentId" = :parentId
        AND p."userId" = :parentUserId
        ${schoolCode ? 'AND su."schoolCode" = :schoolCode' : ''}
        AND ${linkStatusSql('sp')}
      LIMIT 1`,
    { replacements: { studentId: sid, parentId: pid, parentUserId: uid || 0, schoolCode }, type: qtype(), transaction }
  ).catch(() => []);
  return rows.length > 0;
}

async function assertParentOwnsStudent({ parentUserId, parentId, studentId, schoolCode, transaction, includeUser = true } = {}) {
  const parent = parentId ? await Parent.findByPk(parentId, { transaction }).catch(() => null) : await getParentForUser(parentUserId);
  if (!parent) {
    const err = new Error('Parent profile not found'); err.status = 404; throw err;
  }
  const student = await getStudentInSchool(studentId, schoolCode, { transaction });
  if (!student) {
    const err = new Error('Student not found'); err.status = 404; throw err;
  }
  const ok = await ownsStudentId({ parentUserId: parentUserId || parent.userId, parentId: parent.id, studentId: student.id, schoolCode, transaction });
  if (!ok) {
    const err = new Error('Not your child'); err.status = 403; throw err;
  }
  return { parent, student };
}

async function listOwnedStudentIds({ parentUserId, schoolCode, transaction } = {}) {
  const parent = await getParentForUser(parentUserId);
  if (!parent) return [];
  const rows = await sequelize.query(
    `SELECT DISTINCT s."id"
       FROM "StudentParents" sp
       JOIN "Parents" p ON p."id" = sp."parentId"
       JOIN "Students" s ON s."id" = sp."studentId"
       JOIN "Users" su ON su."id" = s."userId"
      WHERE sp."parentId" = :parentId
        AND p."userId" = :parentUserId
        ${schoolCode ? 'AND su."schoolCode" = :schoolCode' : ''}
        AND ${linkStatusSql('sp')}
      ORDER BY s."id" ASC`,
    { replacements: { parentId: parent.id, parentUserId, schoolCode }, type: qtype(), transaction }
  ).catch(() => []);
  return rows.map(r => Number(r.id)).filter(Boolean);
}

async function listOwnedStudents({ parentUserId, schoolCode } = {}) {
  const ids = await listOwnedStudentIds({ parentUserId, schoolCode });
  if (!ids.length) return [];
  return Student.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: { include: ['classId'] },
    include: [{ model: User, attributes: ['id','name','email','phone','schoolCode','profileImage'] }],
    order: [[User, 'name', 'ASC']]
  });
}

module.exports = {
  getParentForUser,
  getStudentInSchool,
  ownsStudentId,
  assertParentOwnsStudent,
  listOwnedStudentIds,
  listOwnedStudents,
  linkStatusSql
};
