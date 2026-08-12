module.exports = (sequelize, DataTypes) => {
  const FinanceExpense = sequelize.define('FinanceExpense', {
    schoolCode:{type:DataTypes.STRING,allowNull:false, references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'}, category:{type:DataTypes.STRING(100),allowNull:false}, description:{type:DataTypes.TEXT,allowNull:false}, amount:{type:DataTypes.DECIMAL(14,2),allowNull:false}, paymentMethod:{type:DataTypes.STRING(60),allowNull:true}, payee:{type:DataTypes.STRING(180),allowNull:true}, expenseDate:{type:DataTypes.DATEONLY,allowNull:false}, reference:{type:DataTypes.STRING(180),allowNull:true}, receiptUrl:{type:DataTypes.TEXT,allowNull:true}, status:{type:DataTypes.STRING(40),allowNull:false,defaultValue:'recorded'}, recordedBy:{type:DataTypes.INTEGER,allowNull:false}, approvedBy:{type:DataTypes.INTEGER,allowNull:true}, approvedAt:{type:DataTypes.DATE,allowNull:true}, notes:{type:DataTypes.TEXT,allowNull:true}, metadata:{type:DataTypes.JSONB,allowNull:false,defaultValue:{}}
  }, { tableName:'FinanceExpenses', indexes:[{fields:['schoolCode','expenseDate']},{fields:['schoolCode','status']},{fields:['recordedBy']}] });
  return FinanceExpense;
};
