export type BookingStatus = "confirmed" | "cancelled" | "completed" | "no_show";
export interface Host { id: string; name: string | null }
export interface Service {
  id: string; slug: string; name: string; description: string | null; durationMin: number; bufferMin: number; location: string | null;
  isPublic: boolean; active: boolean; position: number; hosts: Host[];
}
export interface Booking {
  id: string; serviceId: string; serviceName: string | null; hostId: string; hostName: string | null; startsAt: string; endsAt: string;
  status: BookingStatus; source: "internal" | "public"; customerName: string; customerEmail: string | null; customerPhone: string | null;
  notes: string | null; contactId: string | null; cancelledAt: string | null; cancelReason: string | null; createdAt: string;
}
export interface Slot { start: string; end: string; hosts?: string[]; hostNames?: string[] }
export interface HoursRule { weekday: number; startMin: number; endMin: number }
export interface TimeOff { id: string; hostId: string; startsAt: string; endsAt: string; reason: string | null }
export interface PublicInfo { title: string | null; timezone: string; services: { slug: string; name: string; description: string | null; durationMin: number; location: string | null }[] }
export interface PublicBooking { id: string; service: string; location: string | null; startsAt: string; endsAt: string; status: BookingStatus; name: string; token?: string }
