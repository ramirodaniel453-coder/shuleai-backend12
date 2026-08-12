module.exports=(sequelize,DataTypes)=>sequelize.define('AbsenceReport',{
  schoolCode:{type:DataTypes.STRING,allowNull:false,references:{model:'Schools',key:'schoolId'},onUpdate:'CASCADE',onDelete:'RESTRICT'},
  studentId:{type:DataTypes.INTEGER,allowNull:false,references:{model:'Students',key:'id'}},
  parentId:{type:DataTypes.INTEGER,allowNull:false,references:{model:'Parents',key:'id'}},
  classId:{type:DataTypes.INTEGER,allowNull:true,references:{model:'Classes',key:'id'}},
  startDate:{type:DataTypes.DATEONLY,allowNull:false}, endDate:{type:DataTypes.DATEONLY,allowNull:false},
  reason:{type:DataTypes.TEXT,allowNull:false},
  status:{type:DataTypes.ENUM('reported','applied','rejected','cancelled'),allowNull:false,defaultValue:'reported'},
  reportedByUserId:{type:DataTypes.INTEGER,allowNull:false,references:{model:'Users',key:'id'}},
  reviewedBy:{type:DataTypes.INTEGER,allowNull:true,references:{model:'Users',key:'id'}}, reviewedAt:{type:DataTypes.DATE,allowNull:true}, reviewNote:{type:DataTypes.TEXT,allowNull:true},
  metadata:{type:DataTypes.JSONB,allowNull:false,defaultValue:{}}
},{tableName:'AbsenceReports',timestamps:true,indexes:[{fields:['schoolCode','status','startDate']},{fields:['studentId','createdAt']},{fields:['classId','status']} ]});
