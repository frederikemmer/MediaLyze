import type { NotificationInput } from "./notifications";
export type NotificationHistoryWrite = Pick<NotificationInput, "type" | "message" | "source"> & { event_id: string };
export type NotificationHistoryItem = Pick<NotificationInput, "type" | "message" | "source"> & { id: number; created_at: string };
export type NotificationHistoryPage = { items: NotificationHistoryItem[]; total: number; next_before_id: number | null };
