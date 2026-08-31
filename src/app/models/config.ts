export type ConfigMember = {
  principal_id: string;
  display_name: string;
  type: string;
  role: "owner" | "member";
};

export type ConfigProject = {
  id: string;
  parent_id: string | null;
  name: string;
};

export type ConfigStage = {
  key: string;
  label: string;
  position: number;
};

export type ConfigStatus = "loading" | "ready" | "error" | "no_session";
