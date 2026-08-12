const { sequelize, User, School } = require('../models');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function seedSuperAdmin() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    // Check if super admin already exists
    const existing = await User.findOne({ 
      where: { role: 'super_admin' } 
    });

    if (existing) {
      console.log('✅ Super admin already exists');
      process.exit(0);
    }

    // Create super admin
    const superAdmin = await User.create({
      name: 'Super Admin',
      email: process.env.SUPER_ADMIN_EMAIL || 'super@shuleai.com',
      password: process.env.SUPER_ADMIN_PASSWORD || require('./passwords').generateTemporaryPassword(),
      role: 'super_admin',
      isActive: true
    });

    console.log('✅ Super admin created successfully');
    console.log('📧 Email:', superAdmin.email);
    console.log('🔐 Super-admin credentials were loaded securely and are not printed.');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  seedSuperAdmin();
}
