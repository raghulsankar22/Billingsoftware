// The desktop File menu opens these pages. It can't see who is signed in, so the page checks here.
export const fileMenuEvent = "billing-file-menu";

export type FileMenuPage = "import" | "my-account" | "users" | "settings";
export type FileMenuAccess = { localStorage: boolean; signedInUser: boolean; administrator: boolean };

export function fileMenuPage(page: unknown, access: FileMenuAccess): FileMenuPage | null {
  if (page === "settings") return page;
  if (page === "import") return access.localStorage ? page : null;
  if (page === "my-account") return access.signedInUser ? page : null;
  if (page === "users") return access.administrator ? page : null;
  return null;
}
