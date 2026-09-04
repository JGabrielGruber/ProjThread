export type WikiListNode = {
  id: string;
  workspace_id: string;
  type: string;
  payload_kind: string;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
  pinned: number;
};

export type WikiNode = WikiListNode & {
  organization_id: string;
  content: string | null;
  mime_type?: string | null;
  byte_size?: number | null;
  filename?: string | null;
};

export type WikiStatus = "loading" | "ready" | "error" | "no_session";

export type WikiCreate = {
  title: string;
  content?: string;
  type?: string;
  payload_kind?: "markdown" | "json" | "blob";
  work_item_id?: string;
};

export type WikiBlobCreate = FormData;
