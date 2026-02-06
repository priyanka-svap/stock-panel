// middleware/adminAuth.js
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Verify admin is authenticated
const adminAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required'
      });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if this is an admin token
    if (!decoded.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    const admin = await Admin.findById(decoded.adminId);
    
    if (!admin || !admin.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Admin account inactive or not found'
      });
    }
    
    req.admin = {
      adminId: admin._id,
      username: admin.username,
      role: admin.role,
      permissions: admin.permissions
    };
    
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid admin token',
      error: error.message
    });
  }
};

// Check specific permission
const checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.admin.permissions[permission]) {
      return res.status(403).json({
        success: false,
        message: `Permission denied: ${permission} required`
      });
    }
    next();
  };
};

// Check if super admin
const requireSuperAdmin = (req, res, next) => {
  if (req.admin.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      message: 'Super admin access required'
    });
  }
  next();
};

module.exports = { adminAuth, checkPermission, requireSuperAdmin };
