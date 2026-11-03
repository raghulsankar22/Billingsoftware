import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { navGroups, SideNav, type NavAccess } from "./side-nav";

// Tests don't resolve the "@/" shortcut, so point it at the real files.
vi.mock("@/lib/app-theme", async () => import("../lib/app-theme"));
vi.mock("@/lib/business-updates", async () => import("../lib/business-updates"));
vi.mock("@/lib/nav-counts", async () => import("../lib/nav-counts"));
vi.mock("@/lib/language", async () => import("../lib/language"));
vi.mock("./api", () => ({ api: vi.fn(() => new Promise(() => {})) }));
// The test runner compiles JSX to React.createElement calls.
(globalThis as { React?: typeof React }).React = React;

const views = (access: NavAccess) => navGroups(access).flatMap(group => group.items.map(item => item.view));
const desktop: NavAccess = { localStorage: true, inDesktopApp: true, signedInUser: true, administrator: true };

describe("slim side menu", () => {
  it("keeps settings pages in the desktop File menu, as before", () => {
    expect(views(desktop)).toEqual(["dashboard", "delivery", "customers", "cashbook", "bills", "delivery-bills", "lost-bills", "notice", "overdue", "search"]);
  });
  it("still shows settings pages on the website, by permission", () => {
    expect(views({ ...desktop, inDesktopApp: false })).toEqual(expect.arrayContaining(["import", "my-account", "users", "settings"]));
    const staff = views({ ...desktop, inDesktopApp: false, administrator: false });
    expect(staff).toContain("my-account"); expect(staff).not.toContain("users");
    const singleUser = views({ ...desktop, inDesktopApp: false, signedInUser: false, administrator: false });
    expect(singleUser).not.toContain("my-account"); expect(singleUser).toContain("settings");
  });
  it("shows only All bills and Business profile in cloud mode", () => {
    expect(views({ localStorage: false, inDesktopApp: false, signedInUser: false, administrator: false })).toEqual(["bills", "settings"]);
  });
  it("renders a labelled, keyboard-resizable slim bar with the open page marked", () => {
    const html = renderToStaticMarkup(<SideNav view="notice" access={desktop} accountSlot={1} countsVersion={0} countsEnabled onSelect={() => {}} />);
    expect(html).toContain('aria-label="Billing menu"');
    expect(html).toContain('class="app-rail"');
    expect(html).toContain('style="width:68px"');
    expect(html).toMatch(/aria-current="page" aria-label="Notice"/);
    expect(html).toContain('role="separator"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-valuenow="68"');
    expect(html).toContain('aria-label="Switch to light mode"');
    for (const label of ["Home", "Bills", "Delivered", "Bill lost", "Overdue", "New bill"]) expect(html).toContain(`>${label}<`);
    expect(html).not.toContain("Business profile");
  });
});
