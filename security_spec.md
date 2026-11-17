# Security Specification — ChantierShot Access Control

## 1. Data Invariants
1. Every document in `/access_users/{userId}` MUST have `uid == userId` matching the authenticated user's UID (`^[a-zA-Z0-9_-]+$`, max 128 chars).
2. Only `pirquinfabien@gmail.com` with `request.auth.token.email_verified == true` holds administrator authority (`isAdmin()`).
3. Non-admin users can ONLY create their own `/access_users/{uid}` document with `role == 'user'`, `status == 'pending'`, and `email == request.auth.token.email`, using server timestamps (`request.time`).
4. Non-admin users can NEVER elevate their own `role` or change their own `status` to `'approved'`.
5. Non-admin users can NEVER list `/access_users` or read another colleague's `/access_users/{otherUid}` document (PII email isolation).
6. Only the verified administrator (`pirquinfabien@gmail.com`) can approve (`'approved'`), revoke (`'revoked'`), add notes, or delete colleague records.

## 2. Dirty Dozen Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Self-Approval on Create**: Colleague sends `{ uid: me, email: meEmail, displayName: "Bob", role: "user", status: "approved", createdAt: serverTime, updatedAt: serverTime }`.
2. **Self-Admin Escalation on Create**: Colleague sends `{ uid: me, email: meEmail, displayName: "Bob", role: "admin", status: "approved", createdAt: serverTime, updatedAt: serverTime }`.
3. **Self-Approval on Update**: Colleague updates own doc with `{ status: "approved", updatedAt: serverTime }`.
4. **Role Escalation on Update**: Approved colleague updates own doc with `{ role: "admin", updatedAt: serverTime }`.
5. **Email Spoofing (Unverified Email)**: Attacker with `email: "pirquinfabien@gmail.com"` and `email_verified: false` tries to list `/access_users` or update status.
6. **Ghost Field / Shadow Write**: Colleague includes `{ isVerified: true }` or `{ superAdmin: true }` in create/update payload.
7. **PII Leak (Read Other User)**: Approved colleague tries `get(/access_users/otherUid)`.
8. **Directory Scraping (List All Users)**: Approved colleague tries `list(/access_users)`.
9. **Identity Spoofing**: Colleague creates `/access_users/victimUid` with `{ uid: "victimUid" }` or `{ uid: me }` under another path.
10. **Immutable Field Tampering**: Colleague updates `createdAt` or `email` on their own document.
11. **Forged Timestamp**: Client sends backdated `createdAt` or `updatedAt` instead of `request.time`.
12. **Resource Exhaustion / Oversized ID or String**: Client attempts write with `userId` > 128 chars, invalid characters (`../`), or `displayName` > 120 chars.
