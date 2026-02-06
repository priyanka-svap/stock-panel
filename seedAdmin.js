// seedAdmin.js - Create Default Admin Account
const mongoose = require('mongoose');
const Admin = require('./models/Admin');
require('dotenv').config();

async function seedAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockPanelDB');
    console.log('✅ Connected to MongoDB\n');
    
    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ username: 'admin' });
    
    if (existingAdmin) {
      console.log('⚠️  Admin already exists!');
      console.log('━'.repeat(60));
      console.log('Username:', existingAdmin.username);
      console.log('Email:', existingAdmin.email);
      console.log('Role:', existingAdmin.role);
      console.log('━'.repeat(60));
      process.exit(0);
    }
    
    // Create super admin
    const superAdmin = new Admin({
      username: 'admin',
      email: 'admin@stockpanel.com',
      password: 'admin123',
      fullName: 'Super Administrator',
      role: 'super_admin',
      permissions: {
        canManageUsers: true,
        canManageStocks: true,
        canManageOrders: true,
        canManageIndices: true,
        canUpdatePrices: true,
        canViewAnalytics: true
      }
    });
    
    await superAdmin.save();
    
    console.log('✅ Super Admin Created Successfully!\n');
    console.log('━'.repeat(60));
    console.log('👤 ADMIN LOGIN CREDENTIALS');
    console.log('━'.repeat(60));
    console.log('Username: admin');
    console.log('Password: admin123');
    console.log('Role: super_admin');
    console.log('Email:', superAdmin.email);
    console.log('━'.repeat(60));
    console.log('\n🔐 Admin Panel Endpoints:');
    console.log('  POST   /api/admin/login              - Admin login');
    console.log('  GET    /api/admin/dashboard/stats    - Dashboard statistics');
    console.log('  GET    /api/admin/users              - Manage all users');
    console.log('  GET    /api/admin/stocks             - Manage all stocks');
    console.log('  PUT    /api/admin/stocks/:symbol/price - Update stock price');
    console.log('  GET    /api/admin/orders             - View all orders');
    console.log('  GET    /api/admin/indices            - Manage indices');
    console.log('  PUT    /api/admin/indices/:name/price - Update index price');
    console.log('━'.repeat(60));
    console.log('\n⚠️  IMPORTANT: Change the default password after first login!\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error.message);
    process.exit(1);
  }
}

seedAdmin();
