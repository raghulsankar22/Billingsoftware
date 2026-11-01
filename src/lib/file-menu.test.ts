import { expect, it } from "vitest";
import { fileMenuPage } from "./file-menu";

const administrator = { localStorage: true, signedInUser: true, administrator: true };
const staff = { localStorage: true, signedInUser: true, administrator: false };

it("opens every File menu page for an administrator", () => {
  for (const page of ["import", "my-account", "users", "settings"]) expect(fileMenuPage(page, administrator)).toBe(page);
});

it("keeps Users from someone who isn't an administrator", () => {
  expect(fileMenuPage("users", staff)).toBeNull();
  expect(fileMenuPage("my-account", staff)).toBe("my-account");
});

it("refuses pages that this setup doesn't have", () => {
  expect(fileMenuPage("import", { ...staff, localStorage: false })).toBeNull();
  expect(fileMenuPage("my-account", { localStorage: true, signedInUser: false, administrator: false })).toBeNull();
});

it("ignores anything that isn't a File menu page", () => {
  for (const page of ["bills", "", null, undefined, 1, {}]) expect(fileMenuPage(page, administrator)).toBeNull();
});
