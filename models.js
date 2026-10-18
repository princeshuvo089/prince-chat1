import mongoose from 'mongoose';

// ১. ইউজার স্কিমা (মোবাইল, পাসওয়ার্ড, গুগল প্রোফাইল)
const userSchema = new mongoose.Schema({
  phone: { 
    type: String, 
    unique: true, 
    sparse: true, 
    trim: true 
  },
  password: { 
    type: String, 
    select: false 
  },
  googleId: { 
    type: String, 
    unique: true, 
    sparse: true 
  },
  displayName: { 
    type: String, 
    default: 'Prince User', 
    trim: true 
  },
  username: { 
    type: String, 
    unique: true, 
    sparse: true, 
    lowercase: true, 
    trim: true 
  },
  avatar: { 
    type: String, 
    default: 'https://cdn.imgchest.com/files/00feb4d9ce79.png' 
  },
  about: { 
    type: String, 
    default: 'Dream • Create • Achieve' 
  },
  isVerified: { 
    type: Boolean, 
    default: false 
  },
  otpCode: { 
    type: String 
  },
  otpExpires: { 
    type: Date 
  },
  online: { 
    type: Boolean, 
    default: false 
  },
  lastSeen: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

// ২. কনভারসেশন স্কিমা (দুই ইউজারের মধ্যবর্তী চ্যাট)
const conversationSchema = new mongoose.Schema({
  participants: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  lastMessage: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Message' 
  }
}, { timestamps: true });

// ৩. মেসেজ স্কিমা (টেক্সট, ছবি, ভিডিও, ফাইল শেয়ারিং)
const messageSchema = new mongoose.Schema({
  conversationId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Conversation', 
    required: true, 
    index: true 
  },
  sender: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  type: { 
    type: String, 
    enum: ['text', 'image', 'video', 'file'], 
    default: 'text' 
  },
  text: { 
    type: String, 
    default: '' 
  },
  fileUrl: { 
    type: String, 
    default: '' 
  },
  fileName: { 
    type: String, 
    default: '' 
  },
  fileSize: { 
    type: String, 
    default: '' 
  },
  read: { 
    type: Boolean, 
    default: false 
  }
}, { timestamps: true });

export const User = mongoose.model('User', userSchema);
export const Conversation = mongoose.model('Conversation', conversationSchema);
export const Message = mongoose.model('Message', messageSchema);
