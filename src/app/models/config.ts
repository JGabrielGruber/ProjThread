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

export type ConfigSubscription = {
  id: string;
  url: string;
  kinds: string[];
  enabled: boolean;
  created_at: string;
};

export type ConfigStatus = "loading" | "ready" | "error" | "no_session";
