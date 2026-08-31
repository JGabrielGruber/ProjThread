export type RoomStatus = "idle" | "loading" | "ready" | "error" | "no_session";

export type TapeLine = {
  seq: number;
  kind: "chat" | "activity";
  body: string;
  actor_id: string | null;
  event_id: string | null;
  created_at: string;
};

export type ActivityEvent = {
  id: string;
  work_item_id: string;
  type: string;
  from_value: string | null;
  to_value: string | null;
  body: string | null;
  actor_id: string;
  ref_node_id: string | null;
  created_at: string;
};

export type RoomItem = {
  id: string;
  title: string;
  stage_key: string;
  owner_id?: string | null;
};
