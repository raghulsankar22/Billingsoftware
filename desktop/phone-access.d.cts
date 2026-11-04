export const phonePort: number;
export const phoneHeader: string;
export function isPrivateAddress(address: unknown): boolean;
export function isAllowedHost(host: unknown): boolean;
export function phoneAccessEnabled(directory: string): boolean;
export function setPhoneAccess(directory: string, enabled: boolean): void;
export function phoneAddresses(interfaces?: NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>, port?: number): { kind: "tailscale" | "wifi"; adapter: string; url: string }[];
