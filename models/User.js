// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  fullName: {
    type: String,
    required: true
  },
  clientId: {
    type: String,
    unique: true
  },
  availableBalance: {
    type: Number,
    default: 0
  },
  usedMargin: {
    type: Number,
    default: 0
  },
  totalPnL: {
    type: Number,
    default: 0
  },
  portfolioValue: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate Client ID
userSchema.pre('save', function(next) {
  if (!this.clientId) {
    this.clientId = 'CL' + Date.now() + Math.floor(Math.random() * 1000);
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
