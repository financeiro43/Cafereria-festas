export type UserRole = 'student' | 'vendor' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  balance: number;
  role: UserRole;
  qrCode: string;
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
