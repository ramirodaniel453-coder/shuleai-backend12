const { yearlyBusinessId } = require('../utils/businessIds');
module.exports = (sequelize, DataTypes) => {
  const Teacher = sequelize.define('Teacher', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    employeeId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      defaultValue: () => yearlyBusinessId('TCH')
    },
    classId: {
      type: DataTypes.INTEGER,
       allowNull: true,
       references: { model: 'Classes', key: 'id' }
    },
    subjects: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    department: {
      type: DataTypes.STRING,
      defaultValue: 'general'
    },
    classTeacher: DataTypes.STRING,
    qualification: DataTypes.STRING,
    specialization: DataTypes.STRING,
    dateJoined: { 
      type: DataTypes.DATE, 
      defaultValue: DataTypes.NOW 
    },
    approvalStatus: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'suspended'),
      defaultValue: 'pending'
    },
    approvedBy: DataTypes.INTEGER,
    approvedAt: DataTypes.DATE,
    rejectionReason: DataTypes.STRING,
    duties: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    dutyPreferences: {
      type: DataTypes.JSONB,
      defaultValue: {
        preferredDays: [],
        blackoutDates: [],
        maxDutiesPerWeek: 3,
        preferredAreas: []
      }
    },
    timetable: {
      type: DataTypes.JSONB,
      defaultValue: {
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: []
      }
    },
    reminders: { 
      type: DataTypes.JSONB, 
      defaultValue: [] 
    },
    signature: { type: DataTypes.TEXT, allowNull: true },
    signatureUrl: { type: DataTypes.TEXT, allowNull: true },
    statistics: {
      type: DataTypes.JSONB,
      defaultValue: { 
        dutiesCompleted: 0, 
        dutiesMissed: 0, 
        reliabilityScore: 100,
        monthlyDutyCount: 0,
        weeklyDutyCount: 0,
        lastDutyDate: null,
        totalDutiesAssigned: 0
      }
    }
  }, {
    timestamps: true,
    hooks: {
      beforeCreate: async (teacher) => {
        if (!teacher.employeeId || teacher.employeeId.startsWith('TCH-') === false) {
          teacher.employeeId = yearlyBusinessId('TCH');
          console.log('Generated employeeId:', teacher.employeeId);
        }
      },
      afterUpdate: async (teacher) => {
        if (teacher.changed('duties')) {
          teacher.updateReliabilityScore();
        }
      }
    }
  });

  Teacher.prototype.getTodayDuty = function() {
    const today = new Date().setHours(0,0,0,0);
    return (this.duties || []).find(d => {
      const dutyDate = new Date(d.date).setHours(0,0,0,0);
      return dutyDate === today;
    });
  };

  Teacher.prototype.updateReliabilityScore = function() {
    const total = (this.statistics.dutiesCompleted || 0) + (this.statistics.dutiesMissed || 0);
    if (total > 0) {
      this.statistics.reliabilityScore = Math.round((this.statistics.dutiesCompleted / total) * 100);
    }
  };

  Teacher.prototype.checkTimetableConflict = function(dayOfWeek, dutyTime) {
    const daySchedule = this.timetable?.[dayOfWeek.toLowerCase()] || [];
    
    const [dutyHour, dutyMinute] = dutyTime.split(':').map(Number);
    const dutyMinutes = dutyHour * 60 + dutyMinute;
    
    return daySchedule.some(period => {
      const [startHour, startMinute] = period.start.split(':').map(Number);
      const [endHour, endMinute] = period.end.split(':').map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;
      
      return dutyMinutes >= startMinutes && dutyMinutes <= endMinutes;
    });
  };

  Teacher.prototype.getMonthlyDutyCount = function() {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    return (this.duties || []).filter(d => {
      const dutyDate = new Date(d.date);
      return dutyDate.getMonth() === currentMonth && 
             dutyDate.getFullYear() === currentYear;
    }).length;
  };

  return Teacher;
};
