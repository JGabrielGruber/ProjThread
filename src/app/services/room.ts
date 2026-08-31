import type { ActivityEvent, RoomItem } from "../models/room.ts";
import { apiJson } from "./http.ts";

export function getWorkItem(id: string): Promise<RoomItem> {
  return apiJson(`/api/work-items/${id}`);
}

export function listEvents(
  id: string,
): Promise<{ events?: ActivityEvent[] }> {
  return apiJson(`/api/work-items/${id}/events`);
}

export function postEvent(
  id: string,
  payload: {
    type: string;
    from?: string | null;
    to?: string | null;
    body?: string;
  },
): Promise<{ event: ActivityEvent; work_item: RoomItem }> {
  return apiJson(`/api/work-items/${id}/events`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
