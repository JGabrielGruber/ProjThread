export type Project = {
  id: string;
  parent_id: string | null;
  name: string;
};

export type Stage = {
  key: string;
  label: string;
  position: number;
};

export type WorkItem = {
  id: string;
  project_id: string;
  workspace_id: string;
  organization_id: string;
  title: string;
  stage_key: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BoardStatus = "loading" | "ready" | "error";
