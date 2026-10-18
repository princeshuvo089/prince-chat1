import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { User, Conversation, Message } from './models.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'prince_chat_royal_secret_2026';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/princechat';

// মিডলওয়্যার
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));

// ফাইল আপলোড ডিরেক্টরি
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

// মুল্টার ফাইল স্টোরেজ কনফিগারেশন
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ডাটাবেস সংযোগ
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Prince Chat MongoDB Connected!'))
  .catch(err => console.log('⚠️ MongoDB Note:', err.message));

// অথেন্টিকেশন টোকেন ভেরিফিকেশন মিডলওয়্যার
const protect = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'লগইন আবশ্যক' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id);
    if (!req.user) return res.status(401).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'টোকেনের মেয়াদ শেষ বা অবৈধ' });
  }
};

// =================== অথেন্টিকেশন API ===================

// ১. রেজিস্টার (মোবাইল নম্বর + পাসওয়ার্ড)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'ফোন নম্বর এবং পাসওয়ার্ড প্রয়োজন' });
    }

    let user = await User.findOne({ phone });
    if (user && user.isVerified) {
      return res.status(400).json({ success: false, message: 'এই নম্বরে ইতিমধ্যে একাউন্ট রয়েছে' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // ৬ ডিজিটের ওটিপি
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // ১০ মিনিট মেয়াদ

    if (!user) {
      user = new User({
        phone,
        password: hashedPassword,
        displayName: `Prince_${phone.slice(-4)}`,
        otpCode: otp,
        otpExpires
      });
    } else {
      user.password = hashedPassword;
      user.otpCode = otp;
      user.otpExpires = otpExpires;
    }

    await user.save();
    console.log(`🔑 [PRINCE CHAT OTP] ফোন: ${phone} -> OTP কোড: ${otp}`);

    res.json({ success: true, message: 'OTP পাঠানো হয়েছে', phone, devOtp: otp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ২. ওটিপি যাচাই (Verify OTP)
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const user = await User.findOne({ phone });

    if (!user || user.otpCode !== otp || new Date() > user.otpExpires) {
      return res.status(400).json({ success: false, message: 'ভুল বা মেয়াদোত্তীর্ণ OTP কোড' });
    }

    user.isVerified = true;
    user.otpCode = undefined;
    user.otpExpires = undefined;
    await user.save();

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

    res.json({ success: true, message: 'ভেরিফিকেশন সফল হয়েছে', user, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ৩. লগইন (Login)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone }).select('+password');

    if (!user) {
      return res.status(400).json({ success: false, message: 'একাউন্ট পাওয়া যায়নি' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'ভুল পাসওয়ার্ড' });
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

    res.json({ success: true, message: 'লগইন সফল হয়েছে', user, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ৪. গুগল লগইন ও অনবোর্ডিং (Google Login)
app.post('/api/auth/google', async (req, res) => {
  try {
    const { googleId, email, name, avatar } = req.body;
    let user = await User.findOne({ googleId });

    if (!user) {
      user = await User.create({
        googleId,
        displayName: name || 'Prince User',
        avatar: avatar || 'https://cdn.imgchest.com/files/00feb4d9ce79.png',
        isVerified: true
      });
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

    res.json({ success: true, user, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ৫. বর্তমান ইউজারের প্রোফাইল
app.get('/api/auth/me', protect, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ৬. লগআউট
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'লগআউট সফল হয়েছে' });
});

// =================== ইউজার ও প্রোফাইল API ===================

// প্রোফাইল এডিট
app.put('/api/users/profile', protect, async (req, res) => {
  try {
    const { displayName, about, avatar } = req.body;
    const user = await User.findById(req.user._id);
    if (displayName) user.displayName = displayName;
    if (about) user.about = about;
    if (avatar) user.avatar = avatar;
    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ফ্রেন্ড সার্চ
app.get('/api/users/search', protect, async (req, res) => {
  try {
    const query = req.query.q;
    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [
        { phone: { $regex: query, $options: 'i' } },
        { displayName: { $regex: query, $options: 'i' } }
      ]
    }).limit(15);
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =================== চ্যাট ও মেসেজ API ===================

// সকল কনভারসেশন তালিকা
app.get('/api/chats', protect, async (req, res) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .populate('participants', 'displayName phone avatar online lastSeen')
      .populate('lastMessage')
      .sort({ updatedAt: -1 });
    res.json({ success: true, conversations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// নির্দিষ্ট চ্যাটের মেসেজ হিস্ট্রি
app.get('/api/chats/:id/messages', protect, async (req, res) => {
  try {
    const messages = await Message.find({ conversationId: req.params.id })
      .populate('sender', 'displayName avatar')
      .sort({ createdAt: 1 });
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// নতুন চ্যাট তৈরি বা ওপেন করা
app.post('/api/chats/start', protect, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    let convo = await Conversation.findOne({
      participants: { $all: [req.user._id, targetUserId] }
    });

    if (!convo) {
      convo = await Conversation.create({
        participants: [req.user._id, targetUserId]
      });
    }

    res.json({ success: true, conversation: convo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ফাইল ও মিডিয়া আপলোড API
app.post('/api/upload', protect, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'ফাইল পাওয়া যায়নি' });

  let type = 'file';
  if (req.file.mimetype.startsWith('image/')) type = 'image';
  else if (req.file.mimetype.startsWith('video/')) type = 'video';

  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    fileUrl,
    type,
    fileName: req.file.originalname,
    fileSize: `${(req.file.size / (1024 * 1024)).toFixed(2)} MB`
  });
});

// ফ্রন্টএন্ড রুট
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =================== রিয়েল-টাইম সকেট (Socket.IO) ===================
const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('user_connected', async (userId) => {
    onlineUsers.set(userId, socket.id);
    await User.findByIdAndUpdate(userId, { online: true });
    io.emit('status_change', { userId, online: true });
  });

  socket.on('join_chat', (convoId) => {
    socket.join(convoId);
  });

  socket.on('send_message', async (data) => {
    const { conversationId, senderId, text, type, fileUrl, fileName, fileSize } = data;
    const msg = await Message.create({
      conversationId,
      sender: senderId,
      text,
      type: type || 'text',
      fileUrl,
      fileName,
      fileSize
    });

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: msg._id,
      updatedAt: new Date()
    });

    const populatedMsg = await Message.findById(msg._id).populate('sender', 'displayName avatar');
    io.to(conversationId).emit('receive_message', populatedMsg);
  });

  socket.on('typing', ({ conversationId, userName }) => {
    socket.to(conversationId).emit('user_typing', { conversationId, userName });
  });

  socket.on('disconnect', async () => {
    for (let [userId, sockId] of onlineUsers.entries()) {
      if (sockId === socket.id) {
        onlineUsers.delete(userId);
        await User.findByIdAndUpdate(userId, { online: false, lastSeen: new Date() });
        io.emit('status_change', { userId, online: false });
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`👑 PRINCE CHAT Server running on http://localhost:${PORT}`);
});
