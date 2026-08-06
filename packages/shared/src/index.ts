export const PRODUCT_NAME = "CollabDocs";

export type WorkspaceKind = "personal" | "team";
export type WorkspaceRole = "owner" | "admin" | "member";

export {
  generateGuestProfile,
  renderGuestAvatar,
  type GuestProfile,
} from "./identity.js";
