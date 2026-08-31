export type Principal = {
  id: string;
  type: string;
  display_name: string;
};

export type Membership = {
  organization_id: string;
  organization_name: string;
  workspace_id: string;
  workspace_name: string;
  role: string;
};
