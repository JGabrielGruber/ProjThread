import type { Membership, Principal } from "../models/session.ts";
import { apiJson } from "./http.ts";

export function getMe(): Promise<{
  principal: Principal;
  memberships?: Membership[];
}> {
  return apiJson("/api/me");
}
