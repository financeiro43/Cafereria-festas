# Security Specification - Cafeteria Inteligente

## Data Invariants
1. A transaction MUST be linked to a valid user.
2. A consumption record MUST be linked to a valid student and vendor.
3. Users cannot modify their own balance directly via client SDKs.
4. Orders can only be created by the owning student with 'pending' status.
5. Vendors can only update orders to 'delivered' or 'cancelled'.
6. Admin credentials (hardcoded or role-based) are required for withdrawals and stall creation.

## The Dirty Dozen - Penetration Test Payloads

1. **Identity Spoofing (Transaction)**: Authenticated User A tries to create a transaction for User B.
2. **Privilege Escalation (User Profile)**: Student tries to update their own role to 'admin'.
3. **Shadow Update (Balance)**: Student tries to increment their balance field directly.
4. **ID Poisoning (Stall)**: Attacker attempts to create a stall with a 2KB junk string as the document ID.
5. **Orphaned Write (Consumption)**: Vendor tries to record consumption for a non-existent student ID.
6. **Self-Assigned Order (Order)**: User A tries to create an order on behalf of User B.
7. **State Jump (Order)**: Student tries to create an order already in 'delivered' status to bypass payment check.
8. **Resource Exhaustion (Product)**: Admin tries to create a product with a 1MB string name.
9. **Email Spoofing**: User with unverified email tries to access admin-only lists.
10. **Terminal State Break**: Attacker tries to change the status of a 'delivered' order back to 'pending'.
11. **PII Leak**: Non-admin authenticated user tries to list all users to scrape emails.
12. **Sync Bypass**: User tries to update balance without creating a corresponding transaction record.

## Test Runner (Simplified)
All tests below MUST return `PERMISSION_DENIED`.

```typescript
// Example test cases in firestore.rules.test.ts logic
await assertFails(setDoc(doc(db, "users", "any"), { balance: 9999 })); // Direct balance update
await assertFails(addDoc(collection(db, "orders"), { status: 'delivered' })); // Creating non-pending order
await assertFails(addDoc(collection(db, "withdrawals"), { amount: 100 })); // Non-admin withdrawal
```
