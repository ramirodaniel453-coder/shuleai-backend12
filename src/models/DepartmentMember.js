module.exports = (sequelize, DataTypes) => {
  const DepartmentMember = sequelize.define('DepartmentMember', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    departmentId: { type: DataTypes.INTEGER, allowNull: false },
    teacherId: { type: DataTypes.INTEGER, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'member' }
  }, { timestamps: true });
  return DepartmentMember;
};
