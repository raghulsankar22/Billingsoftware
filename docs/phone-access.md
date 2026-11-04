# Using billing from a phone

Finance Billing keeps one ledger on the shop computer. Phone access lets a phone open that same
billing website, so a bill made on the phone is saved on the shop computer. There is nothing to
sync, and no customer data is copied to the phone or to a cloud service.

The phone must be able to reach the shop computer. There are two ways:

- **On the shop Wi-Fi:** the phone and the computer are on the same Wi-Fi.
- **From anywhere, through Tailscale:** a free private-network app puts the phone and the
  computer on a private network, so the phone reaches the computer from another city. Billing is
  never put on the public internet.

The shop computer must be on, billing must be open (or running), and the shop must have internet
for the Tailscale route.

## One-time set-up

1. **Turn it on.** Sign in on the shop computer as the administrator, open **Users**, and press
   **Turn on phone access**. A phone cannot turn it on or off.
2. **Allow Windows to connect.** The first time, Windows may ask whether to let billing
   (`node.exe`) communicate on the network. Allow **Private networks**.
3. **For another city, install Tailscale** (tailscale.com, free for personal use) on the shop
   computer and on the phone and sign in to the **same account** on both.
4. **Open the address on the phone.** The Users screen lists the addresses, for example
   `http://100.101.102.103:3120` (Tailscale) or `http://192.168.1.20:3120` (shop Wi-Fi). Type or
   copy one into Chrome or Safari and sign in with your usual username and password.
5. **Add it to the home screen** (Chrome: menu, **Add to Home screen**; Safari: Share,
   **Add to Home Screen**) to get a Billing icon.

Turn phone access off again with **Turn off phone access**. It closes the phone port within a few
seconds. Signed-in phones stop working.

## What is protected

- It is **off** until an administrator turns it on, and only the shop computer can change it.
- The phone port accepts connections only from this computer, home and office networks
  (10.x, 172.16-31.x, 192.168.x) and Tailscale (100.64.0.0/10). A connection from the public
  internet is refused, even if the router forwards the port.
- A phone must sign in. After five wrong passwords for a user, that user is locked for five
  minutes. Sessions last twelve hours.
- The address bar must show an IP address, the computer's name or a private-network name.
  Requests from other websites are refused.
- Tailscale encrypts the traffic between the phone and the computer. On the shop Wi-Fi the page
  is plain HTTP, so anyone connected to that Wi-Fi could see it: use a Wi-Fi password you trust
  and prefer Tailscale for staff phones.
- Anyone on the same Wi-Fi can reach the sign-in page. Use strong passwords.

## What you can and cannot do

A phone can use every screen: New bill, Customers, Delivery, Bills, Overdue, Notices and the
Dashboard. The phone layout stacks tables into cards and uses larger buttons.

- Opening the Users screen is allowed, but **phone access cannot be switched from a phone**.
- Backup folder choices and restores are made on the shop computer.
- If the computer is off or loses its connection, the phone cannot be used. There is no offline
  mode on the phone.
- The installer is not signed and the page is not HTTPS, so the home-screen icon opens billing
  like a bookmark. It is not an app-store app.

## Checking it

`node scripts/verify-phone-access.mjs` starts a disposable copy of the server and checks the
switch, the listener, sign-in from a phone, the refusals above and shut-off. It uses port 3120,
so close anything else using that port first. It cannot test a real phone, the Windows firewall
prompt or a real Tailscale connection: try those once on the real set-up.
