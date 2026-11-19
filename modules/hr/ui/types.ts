export type LeaveStatus = "requested" | "approved" | "rejected" | "cancelled";
export interface Employee {
  id: string; name: string; firstName: string; lastName: string; workEmail: string | null; jobTitle: string | null; department: string | null;
  managerId: string | null; managerName: string | null; userId: string | null; employmentType: "full_time" | "part_time" | "contractor" | "intern";
  startDate: string; endDate: string | null; status: "active" | "left" | "upcoming"; isMe: boolean; private: boolean;
  birthDate?: string | null; phone?: string | null; address?: string | null; emergencyContact?: string | null; annualAllowance?: number | null; notes?: string | null;
}
export interface Balance { year: number; allowance: number; used: number; pending: number; remaining: number }
export interface EmployeeDetail extends Employee { reports: { id: string; name: string; jobTitle: string | null }[]; canSeeLeave: boolean; canManage: boolean; balance: Balance | null }
export interface Leave {
  id: string; employeeId: string; employeeName: string; typeId: string; typeName: string; usesAllowance: boolean; startDate: string; endDate: string;
  halfDay: boolean; days: number; status: LeaveStatus; note: string | null; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  createdAt: string; canDecide: boolean; canCancel: boolean; mine: boolean;
}
export interface LeaveType { id: string; name: string; usesAllowance: boolean; needsApproval: boolean; paid: boolean; position: number; archived: boolean }
export interface Holiday { id: string; day: string; name: string }
export interface Away { id: string; employeeId: string; employeeName: string; startDate: string; endDate: string; halfDay: boolean; status: LeaveStatus; type: string | null }
export interface Doc { id: string; employeeId: string; documentId: string; kind: string; title: string; createdAt: string }
export interface Member { userId: string; name: string | null; email: string }
