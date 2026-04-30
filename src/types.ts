export type UserRole = 'student' | 'vendor' | 'recharge' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  balance: number;
  role: UserRole;
  qrCode: string;
  vendorIds?: string[]; // Multiple stall links
}

export interface Product {
  id: string;
  name: string;
  price: number;
  vendorId: string;
  active: boolean;
}

export interface Stall {
  id: string;
  name: string;
  ownerId?: string; // Optional: Link to a specific user
}

export interface Withdrawal {
  id: string;
  stallId: string;
  amount: number;
  adminId: string;
  note?: string;
  timestamp: any;
}

export interface Order {
  id: string;
  studentId: string;
  stallId: string;
  items: string[];
  total: number;
  status: 'pending' | 'delivered' | 'cancelled';
  timestamp: any;
}

export interface Transaction {
  id: string;
  userId: string;
  amount: number;
  type: 'credit' | 'debit';
  description: string;
  status: 'completed' | 'pending' | 'failed';
  timestamp: any;
}

export interface ConsumptionRecord {
  id: string;
  studentId: string;
  vendorId: string;
  amount: number;
  items: string[];
  timestamp: any;
}
