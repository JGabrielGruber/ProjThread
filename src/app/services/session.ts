import type { Membership, Principal } from "../models/session.ts";
import { apiJson } from "./http.ts";

export type MeBody = {
  principal: Principal;
  memberships?: Membership[];
  workspace_id: string | null;
};

export function getMe(): Promise<MeBody> {
  return apiJson("/api/me");
}

export function patchMe(body: { workspace_id: string }): Promise<MeBody> {
  return apiJson("/api/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
