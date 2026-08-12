const { yearlyBusinessId } = require('../utils/businessIds');
module.exports = (sequelize, DataTypes) => {
    const Admin = sequelize.define('Admin', {
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { 
                model: 'Users', 
                key: 'id' 
            }
        },
        adminId: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            defaultValue: () => yearlyBusinessId('ADM')
        },
        position: {
            type: DataTypes.STRING,
            defaultValue: 'School Administrator'
        },
        permissions: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            defaultValue: ['manage_teachers', 'manage_students', 'manage_duty', 'view_reports']
        },
        managedSchools: {
            type: DataTypes.ARRAY(DataTypes.INTEGER),
            defaultValue: []
        },
        signature: { type: DataTypes.TEXT, allowNull: true },
        signatureUrl: { type: DataTypes.TEXT, allowNull: true }
    }, {
        timestamps: true,
        hooks: {
            beforeCreate: async (admin) => {
                // Only generate if not already set
                if (!admin.adminId || admin.adminId.startsWith('ADM-') === false) {
                    admin.adminId = yearlyBusinessId('ADM');
                    console.log('Generated adminId:', admin.adminId);
                }
            }
        }
    });

    return Admin;
};
