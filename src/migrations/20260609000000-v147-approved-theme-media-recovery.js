'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`ALTER TYPE "enum_Users_role" ADD VALUE IF NOT EXISTS 'finance_officer'`).catch(()=>{});
    await queryInterface.sequelize.query(`ALTER TYPE "enum_Alerts_role" ADD VALUE IF NOT EXISTS 'finance_officer'`).catch(()=>{});
    const tables = await queryInterface.showAllTables();
    const names = new Set(tables.map(x => typeof x === 'string' ? x : (x.tableName || x.name)));
    if (names.has('Users')) {
      const cols = await queryInterface.describeTable('Users');
      if (cols.profileImage) await queryInterface.changeColumn('Users','profileImage',{ type:Sequelize.TEXT, allowNull:true }).catch(()=>{});
      if (!cols.profilePicture) await queryInterface.addColumn('Users','profilePicture',{ type:Sequelize.TEXT, allowNull:true });
      else await queryInterface.changeColumn('Users','profilePicture',{ type:Sequelize.TEXT, allowNull:true }).catch(()=>{});
    }
    for (const table of ['Teachers','Admins']) {
      if (!names.has(table)) continue;
      const cols = await queryInterface.describeTable(table);
      for (const col of ['signature','signatureUrl']) {
        if (cols[col]) await queryInterface.changeColumn(table,col,{ type:Sequelize.TEXT, allowNull:true }).catch(()=>{});
      }
    }
  },
  async down() {
    throw new Error('Irreversible migration 20260609000000-v147-approved-theme-media-recovery.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
