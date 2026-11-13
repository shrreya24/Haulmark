# Haulmark — MERN vehicle tracking

JavaScript app using MongoDB, Express, React, and Node.js. It includes account registration/sign-in, per-account supplier sessions and premises coordinates, private supplier GPS links, straight-line distance, Google Maps routes, and retained trip history.

## Required setup

1. Install Node.js 20 or newer and run MongoDB locally, or create a MongoDB Atlas database.
2. Copy `.env.example` to `.env` and set `MONGODB_URI` plus a private `JWT_SECRET` of at least 32 characters. Do not commit `.env` or paste the secret into chat.
3. Install packages with `npm install`.
4. Run `npm run dev`. Open the Vite URL at `http://localhost:5173`. Both the Vite frontend and Node API must remain running.
5. Register an account, set the premises location, and create a supplier tracking link.

Supplier links work on another phone only after the app has a public HTTPS URL. Set `PUBLIC_BASE_URL` to that URL. Browser geolocation requires HTTPS outside localhost.

## Data and history

MongoDB stores users, password hashes, per-account trips, premise coordinates, and GPS samples. Passwords are bcrypt-hashed; authentication uses an HTTP-only cookie. GPS history samples every minute by default and expired trips are deleted hourly after 30 days. Configure `HISTORY_DAYS` and `HISTORY_SAMPLE_SECONDS` if needed. Each registered account sees only its own dashboard data; a supplier token grants access only to that trip's supplier tracking page.

## Deploy

Use a managed MongoDB instance, set `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`, and the public HTTPS `PUBLIC_BASE_URL`, then run `npm run build` followed by `npm start`. Back up MongoDB securely and restrict database network access. Before public launch, verify account flows and supplier GPS on real devices, cookie settings behind your hosting proxy, MongoDB TTL retention, and account recovery. Numeric distance is straight-line; road-distance numbers need a routing service.

History from the previous JSON-file prototype is not automatically imported into MongoDB.
