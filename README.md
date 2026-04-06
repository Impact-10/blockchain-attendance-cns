# Blockchain-Based Attendance System (CNS Demo)

Minimal UI + cryptography-heavy backend demo for classroom attendance.

## Features

- Faculty generates a short-lived attendance code
- Student submits only:
  - Student ID
  - Attendance code
- Browser captures geolocation automatically
- Backend performs:
  - Canonical payload creation
  - SHA-256 hashing
  - Ed25519 signature generation + verification
  - Nonce-based replay protection
  - Geofence validation (hardcoded polygon)
  - High-CGPA IP restriction
- Valid records stored off-chain
- Faculty override records added as special entries
- Finalization builds Merkle root and appends block to simplified blockchain

## Project Structure

- `server.js` - Express app and routes
- `src/modules/crypto.js` - Hashing, signatures, canonical payload, nonce
- `src/modules/merkle.js` - Merkle tree and root generation
- `src/modules/blockchain.js` - Simplified block chain and verification
- `src/modules/policy.js` - Geofence + IP policies
- `src/services/attendanceService.js` - Attendance business logic
- `src/data/store.js` - JSON persistence
- `public/` - Minimal UI pages and scripts

## Run

1. Install dependencies:
   - `npm install`
2. Start server:
   - `npm start`
3. Open:
   - `http://localhost:3000/generate` (Faculty)
   - `http://localhost:3000/submit` (Student)

## Demo Flow (2-minute presentation)

1. Faculty opens `/generate`, clicks **Generate Attendance Code**.
2. Student opens `/submit`, enters only ID + code, clicks **Submit**.
3. Backend verifies cryptographic and policy checks.
4. Faculty clicks **Finalize Attendance**.
5. Optional: open `/blockchain` to show immutable block history.

## Notes

- Geofence points are in `src/modules/policy.js` (`CLASSROOM_POLYGON`).
- High-CGPA policy lists are in `src/data/store.js` defaults.
- This is a simplified educational blockchain (not distributed consensus).
